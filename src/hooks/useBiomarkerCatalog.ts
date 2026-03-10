import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';

export interface CatalogBiomarker {
  slug: string;
  name: string;
  category: string;
  subcategory: string;
  unit: string;
  sex_applicability: string;
  is_cycle_dependent: boolean;
  is_fasting_sensitive: boolean;
}

interface UseBiomarkerCatalogResult {
  catalog: CatalogBiomarker[];
  loading: boolean;
  error: string | null;
  getBySlug: (slug: string) => CatalogBiomarker | undefined;
  getByCategory: (category: string) => CatalogBiomarker[];
}

let cachedCatalog: CatalogBiomarker[] | null = null;

export function useBiomarkerCatalog(): UseBiomarkerCatalogResult {
  const [catalog, setCatalog] = useState<CatalogBiomarker[]>(cachedCatalog ?? []);
  const [loading, setLoading] = useState(cachedCatalog === null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (cachedCatalog !== null) {
      setCatalog(cachedCatalog);
      setLoading(false);
      return;
    }

    let cancelled = false;

    supabase
      .from('biomarker_catalog')
      .select('slug, name, category, subcategory, unit, sex_applicability, is_cycle_dependent, is_fasting_sensitive')
      .order('category')
      .order('name')
      .then(({ data, error: fetchError }) => {
        if (cancelled) return;
        if (fetchError) {
          setError(fetchError.message);
        } else if (data) {
          cachedCatalog = data as CatalogBiomarker[];
          setCatalog(cachedCatalog);
        }
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const getBySlug = (slug: string) => catalog.find(b => b.slug === slug);
  const getByCategory = (category: string) => catalog.filter(b => b.category === category);

  return { catalog, loading, error, getBySlug, getByCategory };
}
