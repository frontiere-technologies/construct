import { Home } from '@/components/Home'
import { allowAnyAuthenticated } from '@/lib/rbac/access-declarations'

export default function HomePage() {
  allowAnyAuthenticated()
  return <Home />
}
