import { useState, useEffect } from 'react';
import { api } from '../../lib/api';
import { db, auth } from '../../lib/firebase';
import { doc, setDoc, getDoc } from 'firebase/firestore';
import { onAuthStateChanged } from 'firebase/auth';
import { Utensils, UploadCloud, Loader2, CheckCircle2, AlertCircle } from 'lucide-react';

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

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files || e.target.files.length === 0) return;
    
    setUploading(true);
    setError(null);
    setSuccess(null);
    setValidationError(null);

    const file = e.target.files[0];
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
        setMenuItems(parsedItems);
        
        // Auto-save to database
        if (auth.currentUser) {
          try {
            const menuRef = doc(db, 'menus', auth.currentUser.email || auth.currentUser.uid);
            await setDoc(menuRef, {
              items: parsedItems,
              status: 'draft',
              updatedAt: new Date().toISOString()
            });
            setMenuStatus('draft');
            setSuccess('Menu extracted and automatically saved as a draft!');
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
      e.target.value = '';
    }
  };

  const updateItem = (index: number, field: keyof MenuItem, value: string) => {
    const updated = [...menuItems];
    updated[index] = { ...updated[index], [field]: value };
    setMenuItems(updated);
    setValidationError(null); // Clear validation error on edit
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
        
        {/* Upload Area */}
        <div>
          <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">Upload Menu (Image, Excel, JSON)</label>
          <label className="flex flex-col items-center justify-center w-full h-32 border-2 border-slate-300 border-dashed rounded-lg cursor-pointer bg-slate-50 dark:hover:bg-slate-700 hover:bg-slate-100 dark:border-slate-600 dark:hover:border-slate-500 transition-colors">
            <div className="flex flex-col items-center justify-center pt-5 pb-6">
              {uploading ? (
                <Loader2 className="w-8 h-8 text-slate-500 animate-spin mb-2" />
              ) : (
                <UploadCloud className="w-8 h-8 text-slate-500 mb-2" />
              )}
              <p className="text-sm text-slate-500 dark:text-slate-400">Click or drag file here (JPG, PNG, XLSX, JSON)</p>
            </div>
            <input type="file" className="hidden" accept="image/*,.xlsx,.json" onChange={handleFileChange} disabled={uploading} />
          </label>
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
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="flex justify-end gap-3 pt-4 border-t border-slate-200 dark:border-slate-700">
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
