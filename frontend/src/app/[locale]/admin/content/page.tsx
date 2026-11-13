import ContentAdmin from '@/components/admin/ContentAdmin';
import { flatten } from '@/lib/admin';
import bn from '../../../../../messages/bn.json';
import en from '../../../../../messages/en.json';
import ja from '../../../../../messages/ja.json';
import my from '../../../../../messages/my.json';
import ne from '../../../../../messages/ne.json';
import vi from '../../../../../messages/vi.json';

/** The bundled (build-time) strings per language, raw (no ja fallback), so "missing" can be detected. */
const BUNDLED = Object.fromEntries(Object.entries({ ja, en, vi, my, ne, bn }).map(([l, m]) => [l, flatten(m)]));

export default function AdminContentPage() {
  return <ContentAdmin bundled={BUNDLED} />;
}
