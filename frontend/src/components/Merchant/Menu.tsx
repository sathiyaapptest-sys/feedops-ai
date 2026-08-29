import { useState, useEffect, useRef } from 'react';
import { api } from '../../lib/api';
import { db, auth } from '../../lib/firebase';
import { doc, setDoc, getDoc } from 'firebase/firestore';
import { onAuthStateChanged } from 'firebase/auth';
import { Utensils, UploadCloud, Loader2, CheckCircle2, AlertCircle, Plus } from 'lucide-react';

interface MenuItem {
  name: string;
  price: string;
  category: string;
  description: string;
}

export function Menu() {
  const [uploading, setUploading] = useState(false);
  const [menuItems, setMenuItems] = useState<MenuItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [, setLoading] = useState(true);
  const [menuStatus, setMenuStatus] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      if (user) {
        try {
          const menuRef = doc(db, 'menus', user.email || user.uid);
          const menuSnap = await getDoc(menuRef);
          if (menuSnap.exists()) {
            const data = menuSnap.data();
            if (data.items && Array.isArray(data.items)) {
              setMenuItems(data.items);
            }
            if (data.status) {
              setMenuStatus(data.status);
            }
          }
        } catch (err) {
          console.error("Failed to load menu", err);
        }
      }
      setLoading(false);
    });
    return () => unsubscribe();
  }, []);

  // Shared by both the file-picker input and drag-and-drop -- the dropzone's
  // own text always said "Click or drag file here," but nothing ever wired
  // up onDrop/onDragOver, so dropping a file silently did nothing (the
  // browser's default behavior for an unhandled drop, usually just
  // navigating away). Extracted so both paths run identical logic instead
  // of duplicating it.
  const processFile = async (file: File) => {
    setUploading(true);
    setError(null);
    setSuccess(null);
    setValidationError(null);

    try {
      let data;
      if (file.name.endsWith('.json') || file.name.endsWith('.xlsx')) {
        data = await api.uploadSpreadsheet(file);
      } else {
        data = await api.uploadMenuImage(file);
      }

      if (data.status === 'error') {
        setError(data.message || 'Upload failed');
        return;
      }

      // Convert dynamic extraction result into editable state
      let parsedItems: MenuItem[] = [];
      if (Array.isArray(data.data)) {
        parsedItems = data.data.map((item: any) => ({
          name: item.name || item.itemName || '',
          price: item.price !== undefined ? String(item.price) : '',
          category: item.category || 'Uncategorized',
          description: item.description || ''
        }));
      } else if (data.data && Array.isArray(data.data.menu)) {
        parsedItems = data.data.menu.map((item: any) => ({
          name: item.name || '',
          price: item.price !== undefined ? String(item.price) : '',
          category: item.category || 'Uncategorized',
          description: item.description || ''
        }));
      } else if (data.data && Array.isArray(data.data.sections)) {
        data.data.sections.forEach((section: any) => {
          if (Array.isArray(section.items)) {
            section.items.forEach((item: any) => {
              parsedItems.push({
                name: item.name || '',
                price: item.price_micros !== undefined ? String(item.price_micros / 1000000) : '',
                category: section.name || 'Uncategorized',
                description: item.description || ''
              });
            });
          }
        });
      } else {
        // Fallback or empty if not array
        parsedItems = [];
      }
      
      if (parsedItems.length === 0) {
        setError('No items extracted from the file.');
      } else {
        // Append to whatever's already loaded/uploaded, rather than
        // replacing it -- a menu is commonly split across several photos
        // (appetizers, mains, desserts...), and each upload used to
        // silently overwrite the previous one, both locally and once
        // auto-saved to Firestore. Accumulating on its own reopens a
        // different problem though: accidentally uploading the same page
        // twice now duplicates instead of overwriting, so dedupe -- against
        // both what's already in the menu and duplicates within this same
        // upload (extraction occasionally double-lists an item).
        //
        // Keyed on name + category + price together, not name alone: the
        // same dish name can legitimately appear more than once with a
        // different category/price (e.g. "Fried Rice" under both Breakfast
        // and Dinner) -- name-only dedup would wrongly drop the second one.
        const dedupeKey = (item: MenuItem) => {
          const priceNum = parseFloat(item.price);
          const priceKey = isNaN(priceNum) ? item.price.trim().toLowerCase() : priceNum.toFixed(2);
          return `${item.name.trim().toLowerCase()}|${item.category.trim().toLowerCase()}|${priceKey}`;
        };
        const seenKeys = new Set(menuItems.map(dedupeKey));
        const newItems: MenuItem[] = [];
        let duplicateCount = 0;
        for (const item of parsedItems) {
          const key = dedupeKey(item);
          if (item.name.trim() && seenKeys.has(key)) {
            duplicateCount += 1;
            continue;
          }
          if (item.name.trim()) seenKeys.add(key);
          newItems.push(item);
        }

        const combinedItems = [...menuItems, ...newItems];
        setMenuItems(combinedItems);

        const dupeNote = duplicateCount > 0 ? ` (${duplicateCount} duplicate${duplicateCount === 1 ? '' : 's'} already in your menu skipped)` : '';

        // Auto-save to database
        if (auth.currentUser) {
          try {
            const menuRef = doc(db, 'menus', auth.currentUser.email || auth.currentUser.uid);
            await setDoc(menuRef, {
              items: combinedItems,
              status: 'draft',
              updatedAt: new Date().toISOString()
            });
            setMenuStatus('draft');
            setSuccess(`Added ${newItems.length} new item(s)${dupeNote} from this upload (${combinedItems.length} total) and saved as a draft.`);
          } catch (saveErr: any) {
            console.error(saveErr);
            setError('Menu extracted, but failed to save to database: ' + saveErr.message);
          }
        } else {
          setSuccess('Menu extracted successfully. Please log in to save.');
        }
      }
    } catch (err: any) {
      console.error(err);
      setError(err.message || 'An error occurred during upload.');
    } finally {
      setUploading(false);
    }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files || e.target.files.length === 0) return;
    const file = e.target.files[0];
    e.target.value = ''; // reset now so picking the same file again later still fires onChange
    await processFile(file);
  };

  const [isDragging, setIsDragging] = useState(false);

  const handleDrop = async (e: React.DragEvent<HTMLLabelElement>) => {
    e.preventDefault();
    setIsDragging(false);
    if (uploading) return;
    if (!e.dataTransfer.files || e.dataTransfer.files.length === 0) return;
    await processFile(e.dataTransfer.files[0]);
  };

  const handleDragOver = (e: React.DragEvent<HTMLLabelElement>) => {
    e.preventDefault(); // required, or the browser refuses the drop entirely
    if (!isDragging) setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent<HTMLLabelElement>) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const updateItem = (index: number, field: keyof MenuItem, value: string) => {
    const updated = [...menuItems];
    updated[index] = { ...updated[index], [field]: value };
    setMenuItems(updated);
    setValidationError(null); // Clear validation error on edit
  };

  const removeItem = (index: number) => {
    setMenuItems(menuItems.filter((_, i) => i !== index));
    setValidationError(null);
  };

  const clearMenu = () => {
    setMenuItems([]);
    setMenuStatus(null);
    setSuccess(null);
    setValidationError(null);
  };

  const handleValidate = () => {
    for (let i = 0; i < menuItems.length; i++) {
      const item = menuItems[i];
      if (!item.name.trim()) {
        setValidationError(`Item at row ${i + 1} is missing a name.`);
        return false;
      }
      if (!item.price.trim() || isNaN(Number(item.price))) {
        setValidationError(`Item "${item.name}" has an invalid price.`);
        return false;
      }
    }
    setValidationError(null);
    return true;
  };

  const handleSave = async () => {
    if (!handleValidate()) return;
    if (!auth.currentUser) {
      setValidationError("You must be logged in to save.");
      return;
    }

    setSaving(true);
    setSuccess(null);
    try {
      const menuRef = doc(db, 'menus', auth.currentUser.email || auth.currentUser.uid);
      await setDoc(menuRef, {
        items: menuItems,
        status: 'published',
        updatedAt: new Date().toISOString()
      });
      setMenuStatus('published');
      setSuccess('Menu successfully saved and published to database!');
    } catch (err: any) {
      console.error(err);
      setError('Failed to save to database: ' + err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="min-h-full flex flex-col">
      {/* Flush Sticky Header */}
      <div className="sticky top-0 z-30 bg-slate-50 dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 shadow-sm">
        <div className="max-w-7xl mx-auto px-6 md:px-8 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-green-500/10 text-green-500 flex items-center justify-center">
              <Utensils className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-xl font-bold text-slate-900 dark:text-white">Menu &amp; Dishes</h1>
                <span className="text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded-full bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-300">
                  Step 3 · Optional Enhancement
                </span>
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400">Upload, extract with Gemini Vision, and manage dish catalogs for optional Google Food Menu feeds.</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {menuItems.length > 0 && (
              <span className="px-3 py-1 text-xs font-semibold bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300 rounded-full border border-blue-200 dark:border-blue-800/50">
                {menuItems.length} Dishes
              </span>
            )}
            {menuStatus === 'published' && (
              <span className="px-3 py-1 text-xs font-semibold bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300 rounded-full border border-green-200 dark:border-green-800/50">
                Published
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Main Content Area */}
      <div className="max-w-7xl w-full mx-auto px-6 md:px-8 py-6 md:py-8 space-y-6 pb-16">
        <div className="p-6 bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700 space-y-6">
          
          {/* Upload Area */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="block text-sm font-semibold text-slate-800 dark:text-slate-200">
                {menuItems.length > 0 ? `Add More Items (${menuItems.length} items currently in menu)` : 'Upload Menu (Photo, Excel, JSON)'}
              </label>
              <span className="text-xs text-slate-500">Multimodal Gemini Vision enabled</span>
            </div>
            <label
              onDrop={handleDrop}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              className={`flex flex-col items-center justify-center w-full h-32 border-2 border-dashed rounded-xl cursor-pointer transition-all ${
                isDragging
                  ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20 shadow-md'
                  : 'border-slate-300 bg-slate-50 dark:hover:bg-slate-700/60 hover:bg-slate-100/80 dark:border-slate-600 dark:hover:border-slate-500'
              }`}
            >
              <div className="flex flex-col items-center justify-center pt-4 pb-4 pointer-events-none">
                {uploading ? (
                  <Loader2 className="w-8 h-8 text-blue-500 animate-spin mb-2" />
                ) : (
                  <UploadCloud className={`w-8 h-8 mb-2 ${isDragging ? 'text-blue-500' : 'text-slate-400'}`} />
                )}
                <p className="text-sm font-medium text-slate-700 dark:text-slate-300">
                  {isDragging
                    ? 'Drop your menu file here'
                    : menuItems.length > 0
                    ? 'Click or drag another image/file here to append more dishes'
                    : 'Click to upload or drag menu photo / spreadsheet here (JPG, PNG, XLSX, JSON)'}
                </p>
                <p className="text-xs text-slate-500 mt-0.5">Supports high-res camera photos, PDF menus, and Excel catalogs</p>
              </div>
              <input ref={fileInputRef} type="file" className="hidden" accept="image/*,.xlsx,.json" onChange={handleFileChange} disabled={uploading} />
            </label>

            {menuItems.length > 0 && (
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
                className="mt-3 w-full flex items-center justify-center gap-2 px-4 py-2 border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-200 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors text-sm font-medium disabled:opacity-50"
              >
                <Plus className="w-4 h-4" />
                Add More Menu Items
              </button>
            )}
          </div>

          {error && (
            <div className="p-4 flex gap-2 items-center bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300 rounded-xl text-sm border border-red-200 dark:border-red-800">
              <AlertCircle className="w-5 h-5 shrink-0" />
              {error}
            </div>
          )}

          {success && (
            <div className="p-4 flex gap-2 items-center bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-300 rounded-xl text-sm border border-green-200 dark:border-green-800">
              <CheckCircle2 className="w-5 h-5 shrink-0" />
              {success}
            </div>
          )}

          {/* Editable Preview in Widescreen */}
          {menuItems.length > 0 && (
            <div className="space-y-4 animate-in fade-in slide-in-from-bottom-4 pt-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <h3 className="font-bold text-base text-slate-900 dark:text-white">Dish Catalog</h3>
                  <span className="text-xs text-slate-500 dark:text-slate-400">Review and edit extracted items before publishing.</span>
                </div>
              </div>
              
              {validationError && (
                <div className="p-3.5 bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-300 rounded-xl text-sm border border-amber-200 dark:border-amber-800 flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  <span>{validationError}</span>
                </div>
              )}

              {/* Full Width Table with Plenty of Space */}
              <div className="max-h-[520px] overflow-y-auto overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-700 shadow-xs">
                <table className="w-full text-left text-sm text-slate-700 dark:text-slate-300">
                  <thead className="sticky top-0 z-10 bg-slate-100 dark:bg-slate-800 text-slate-900 dark:text-white uppercase font-semibold text-xs border-b border-slate-200 dark:border-slate-700">
                    <tr>
                      <th className="px-4 py-3.5 w-1/4">Dish Name</th>
                      <th className="px-4 py-3.5 w-28">Price ($)</th>
                      <th className="px-4 py-3.5 w-1/5">Category</th>
                      <th className="px-4 py-3.5">Description</th>
                      <th className="px-4 py-3.5 w-12 text-center">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
                    {menuItems.map((item, idx) => (
                      <tr key={idx} className="bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors">
                        <td className="px-4 py-2.5">
                          <input 
                            type="text" 
                            value={item.name} 
                            onChange={(e) => updateItem(idx, 'name', e.target.value)}
                            className="w-full bg-slate-50/50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 focus:border-blue-500 rounded-lg px-2.5 py-1.5 text-slate-900 dark:text-white text-sm font-medium outline-none transition-colors"
                            placeholder="Dish name"
                          />
                        </td>
                        <td className="px-4 py-2.5 w-28">
                          <input 
                            type="text" 
                            value={item.price} 
                            onChange={(e) => updateItem(idx, 'price', e.target.value)}
                            className="w-full bg-slate-50/50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 focus:border-blue-500 rounded-lg px-2.5 py-1.5 text-slate-900 dark:text-white text-sm font-mono outline-none transition-colors"
                            placeholder="0.00"
                          />
                        </td>
                        <td className="px-4 py-2.5 w-1/5">
                          <input 
                            type="text" 
                            value={item.category} 
                            onChange={(e) => updateItem(idx, 'category', e.target.value)}
                            className="w-full bg-slate-50/50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 focus:border-blue-500 rounded-lg px-2.5 py-1.5 text-slate-900 dark:text-white text-sm outline-none transition-colors"
                            placeholder="e.g. Appetizers"
                          />
                        </td>
                        <td className="px-4 py-2.5">
                          <input
                            type="text"
                            value={item.description}
                            onChange={(e) => updateItem(idx, 'description', e.target.value)}
                            className="w-full bg-slate-50/50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 focus:border-blue-500 rounded-lg px-2.5 py-1.5 text-slate-900 dark:text-white text-sm outline-none transition-colors"
                            placeholder="Ingredients or description..."
                          />
                        </td>
                        <td className="px-4 py-2.5 text-center">
                          <button
                            type="button"
                            onClick={() => removeItem(idx)}
                            title="Remove this dish"
                            className="text-slate-400 hover:text-red-600 dark:hover:text-red-400 transition-colors p-1 rounded-md hover:bg-red-50 dark:hover:bg-red-900/20"
                          >
                            &times;
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Action Bar */}
              <div className="flex items-center justify-between pt-4 border-t border-slate-200 dark:border-slate-700">
                <button
                  onClick={clearMenu}
                  type="button"
                  className="px-4 py-2 bg-red-50 hover:bg-red-100 dark:bg-red-900/20 dark:hover:bg-red-900/40 text-red-700 dark:text-red-300 font-medium rounded-lg transition-colors text-sm"
                  title="Clear the current list"
                >
                  Clear Menu
                </button>
                <div className="flex items-center gap-3">
                  <button
                    onClick={handleValidate}
                    className="px-4 py-2 bg-slate-100 hover:bg-slate-200 dark:bg-slate-700 dark:hover:bg-slate-600 text-slate-700 dark:text-slate-200 font-medium rounded-lg transition-colors text-sm"
                  >
                    Validate Menu
                  </button>
                  <button 
                    onClick={handleSave}
                    disabled={saving}
                    className="px-6 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white font-medium rounded-lg shadow-sm transition-colors flex items-center gap-2 text-sm"
                  >
                    {saving && <Loader2 className="w-4 h-4 animate-spin" />}
                    Save to Database
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
