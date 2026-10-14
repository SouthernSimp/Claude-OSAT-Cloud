/* Uninstall an app from the bar (Oct 2026; Raycast's and AppCleaner's job): the app and what it left in ~/Library go to
   the Bin together, with one Undo. Pure: which apps may go, and where an app's leftovers can be. Leftovers are matched
   only by the app's exact bundle id (com.spotify.client) or its exact name, in the folders apps keep their things in,
   so nothing another app shares is ever touched. Group Containers (shared by a maker's apps) are left alone. */

/* Only an app in /Applications or ~/Applications, never one of the Mac's own and never OSAT itself. */
export function canUninstall(appPath, { home, ownId = 'ai.mccreery.osat', id = null } = {}) {
  const file = String(appPath || '')
  if (!/\.app$/.test(file) || file.includes('/../') || file.includes('/./')) return false
  if (id && id === ownId) return false
  if (/^\/(System|Library|usr|bin|sbin)\//.test(file)) return false
  if (/\/OSAT\.app$/.test(file)) return false
  const parent = file.slice(0, file.lastIndexOf('/'))
  const inApps = parent === '/Applications' || parent.startsWith('/Applications/') || parent === `${home}/Applications`
  return inApps && parent !== '/Applications/Utilities'
}

/* A bundle id worth matching folders by: reverse-DNS with at least one dot, and not one of Apple's. */
export const usableId = (id) => typeof id === 'string' && /^[A-Za-z0-9][\w-]*(\.[\w-]+)+$/.test(id) && !/^com\.apple\./i.test(id)

/* A name worth matching folders by: the app's own (three letters or more), never a word many apps share. */
const SHARED = new Set(['google', 'microsoft', 'adobe', 'apple', 'mozilla', 'jetbrains', 'helper', 'app', 'apps', 'electron', 'chrome'])
export const usableName = (name) => typeof name === 'string' && name.trim().length >= 3 && !SHARED.has(name.trim().toLowerCase()) && !/[/\\]/.test(name)

/* Every place `{ id, name }` may have left something: [{ path, what }]. The caller keeps those that exist. */
export function leftoverPlaces(home, { id = null, name = null } = {}) {
  const lib = `${home}/Library`
  const places = []
  const add = (path, what) => { if (!places.some((place) => place.path === path)) places.push({ path, what }) }
  if (usableId(id)) {
    add(`${lib}/Application Support/${id}`, 'Its data')
    add(`${lib}/Caches/${id}`, 'Its cache')
    add(`${lib}/Preferences/${id}.plist`, 'Its settings')
    add(`${lib}/Saved Application State/${id}.savedState`, 'Its saved windows')
    add(`${lib}/Containers/${id}`, 'Its container')
    add(`${lib}/Application Scripts/${id}`, 'Its scripts')
    add(`${lib}/HTTPStorages/${id}`, 'Its web storage')
    add(`${lib}/HTTPStorages/${id}.binarycookies`, 'Its cookies')
    add(`${lib}/Cookies/${id}.binarycookies`, 'Its cookies')
    add(`${lib}/WebKit/${id}`, 'Its web data')
    add(`${lib}/Logs/${id}`, 'Its logs')
    add(`${lib}/LaunchAgents/${id}.plist`, 'What starts it at login')
  }
  if (usableName(name)) {
    add(`${lib}/Application Support/${name}`, 'Its data')
    add(`${lib}/Caches/${name}`, 'Its cache')
    add(`${lib}/Logs/${name}`, 'Its logs')
  }
  return places
}

/* "412 MB" from kilobytes (du -sk). */
export function sizeLabel(kilobytes) {
  const kb = Math.max(0, Number(kilobytes) || 0)
  if (kb < 1024) return `${Math.max(1, Math.round(kb))} KB`
  if (kb < 1024 * 1024) return `${Math.round(kb / 1024)} MB`
  return `${(kb / 1024 / 1024).toFixed(1)} GB`
}

/* What the bar says before the second Return. */
export function describePlan(plan) {
  const n = plan.leftovers.length
  const rest = n ? ` and ${n} thing${n === 1 ? '' : 's'} it left behind` : ''
  const open = plan.running ? ` ${plan.name} is open; it will be asked to quit first.` : ''
  return `Return again moves ${plan.name}${rest} (${sizeLabel(plan.size)}) to the Bin.${open}`
}
