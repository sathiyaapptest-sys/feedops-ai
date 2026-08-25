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
    <div className="max-w-5xl mx-auto space-y-6">
      <div className="flex items-center gap-3 pb-4 border-b border-slate-200 dark:border-slate-700">
        <Utensils className="w-6 h-6 text-green-500" />
        <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Menu Management</h1>
      </div>

      <div className="p-6 bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700 space-y-6">
        
        {/* Upload Area -- doubles as "Add More" once a menu already exists:
            each upload appends to what's below rather than replacing it, so
            the label and hint say that explicitly instead of relying on the
            user already knowing. */}
        <div>
          <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
            {menuItems.length > 0 ? `Add More Items (${menuItems.length} in menu so far)` : 'Upload Menu (Image, Excel, JSON)'}
          </label>
          <label
            onDrop={handleDrop}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            className={`flex flex-col items-center justify-center w-full h-32 border-2 border-dashed rounded-lg cursor-pointer transition-colors ${
              isDragging
                ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20'
                : 'border-slate-300 bg-slate-50 dark:hover:bg-slate-700 hover:bg-slate-100 dark:border-slate-600 dark:hover:border-slate-500'
            }`}
          >
            <div className="flex flex-col items-center justify-center pt-5 pb-6 pointer-events-none">
              {uploading ? (
                <Loader2 className="w-8 h-8 text-slate-500 animate-spin mb-2" />
              ) : (
                <UploadCloud className={`w-8 h-8 mb-2 ${isDragging ? 'text-blue-500' : 'text-slate-500'}`} />
              )}
              <p className="text-sm text-slate-500 dark:text-slate-400">
                {isDragging
                  ? 'Drop it here'
                  : menuItems.length > 0
                  ? 'Click or drag another page here -- new items are added to your menu below, not replaced'
                  : 'Click or drag file here (JPG, PNG, XLSX, JSON)'}
              </p>
            </div>
            <input ref={fileInputRef} type="file" className="hidden" accept="image/*,.xlsx,.json" onChange={handleFileChange} disabled={uploading} />
          </label>

          {/* Explicit, visible "add more" button -- triggers the same
              hidden file input as the dropzone above, just as a compact,
              unmissable affordance once a menu already has items in it. */}
          {menuItems.length > 0 && (
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              className="mt-3 w-full flex items-center justify-center gap-2 px-4 py-2.5 border-2 border-dashed border-blue-300 dark:border-blue-700 text-blue-600 dark:text-blue-400 rounded-lg hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-colors text-sm font-medium disabled:opacity-50"
            >
              <Plus className="w-4 h-4" />
              Add More Items
            </button>
          )}
        </div>

        {error && (
          <div className="p-4 flex gap-2 items-center bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300 rounded-lg text-sm border border-red-200 dark:border-red-800">
            <AlertCircle className="w-5 h-5" />
            {error}
          </div>
        )}

        {success && (
          <div className="p-4 flex gap-2 items-center bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-300 rounded-lg text-sm border border-green-200 dark:border-green-800">
            <CheckCircle2 className="w-5 h-5" />
            {success}
          </div>
        )}

        {/* Editable Preview */}
        {menuItems.length > 0 && (
          <div className="space-y-4 animate-in fade-in slide-in-from-bottom-4">
            <div className="flex items-center gap-3">
              <h3 className="font-semibold text-slate-900 dark:text-white">Menu Preview</h3>
              <span className="px-2 py-0.5 text-xs font-medium bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300 rounded-full border border-blue-200 dark:border-blue-800/50">
                {menuItems.length} item{menuItems.length === 1 ? '' : 's'}
              </span>
              {menuStatus === 'draft' && (
                <span className="px-2 py-0.5 text-xs font-medium bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300 rounded-full border border-amber-200 dark:border-amber-800/50">Draft</span>
              )}
              {menuStatus === 'published' && (
                <span className="px-2 py-0.5 text-xs font-medium bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300 rounded-full border border-green-200 dark:border-green-800/50">Published</span>
              )}
            </div>
            
            {validationError && (
              <div className="p-3 bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-300 rounded-lg text-sm border border-amber-200 dark:border-amber-800">
                {validationError}
              </div>
            )}

            <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-700">
              <table className="w-full text-left text-sm text-slate-700 dark:text-slate-300">
                <thead className="bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white uppercase font-medium text-xs">
                  <tr>
                    <th className="px-4 py-3">Name</th>
                    <th className="px-4 py-3">Price</th>
                    <th className="px-4 py-3">Category</th>
                    <th className="px-4 py-3">Description</th>
                    <th className="px-4 py-3 w-10"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
                  {menuItems.map((item, idx) => (
                    <tr key={idx} className="bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800/50">
                      <td className="px-4 py-2">
                        <input 
                          type="text" 
                          value={item.name} 
                          onChange={(e) => updateItem(idx, 'name', e.target.value)}
                          className="w-full bg-transparent border-b border-transparent hover:border-slate-300 focus:border-blue-500 outline-none px-1 py-1"
                        />
                      </td>
                      <td className="px-4 py-2 w-24">
                        <input 
                          type="text" 
                          value={item.price} 
                          onChange={(e) => updateItem(idx, 'price', e.target.value)}
                          className="w-full bg-transparent border-b border-transparent hover:border-slate-300 focus:border-blue-500 outline-none px-1 py-1"
                          placeholder="0.00"
                        />
                      </td>
                      <td className="px-4 py-2 w-48">
                        <input 
                          type="text" 
                          value={item.category} 
                          onChange={(e) => updateItem(idx, 'category', e.target.value)}
                          className="w-full bg-transparent border-b border-transparent hover:border-slate-300 focus:border-blue-500 outline-none px-1 py-1"
                        />
                      </td>
                      <td className="px-4 py-2">
                        <input
                          type="text"
                          value={item.description}
                          onChange={(e) => updateItem(idx, 'description', e.target.value)}
                          className="w-full bg-transparent border-b border-transparent hover:border-slate-300 focus:border-blue-500 outline-none px-1 py-1"
                        />
                      </td>
                      <td className="px-2 py-2">
                        <button
                          type="button"
                          onClick={() => removeItem(idx)}
                          title="Remove this item"
                          className="text-slate-400 hover:text-red-600 dark:hover:text-red-400 transition-colors px-1"
                        >
                          &times;
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="flex justify-end gap-3 pt-4 border-t border-slate-200 dark:border-slate-700">
              <button
                onClick={clearMenu}
                type="button"
                className="px-4 py-2 bg-red-50 hover:bg-red-100 dark:bg-red-900/20 dark:hover:bg-red-900/40 text-red-700 dark:text-red-300 font-medium rounded-lg transition-colors mr-auto"
                title="Clear the current list -- doesn't affect what's already saved until you Save again"
              >
                Clear Menu
              </button>
              <button
                onClick={handleValidate}
                className="px-4 py-2 bg-slate-100 hover:bg-slate-200 dark:bg-slate-700 dark:hover:bg-slate-600 text-slate-700 dark:text-slate-200 font-medium rounded-lg transition-colors"
              >
                Validate
              </button>
              <button 
                onClick={handleSave}
                disabled={saving}
                className="px-6 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white font-medium rounded-lg shadow-sm transition-colors flex items-center gap-2"
              >
                {saving && <Loader2 className="w-4 h-4 animate-spin" />}
                Save to Database
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
