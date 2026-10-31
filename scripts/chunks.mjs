// Keep CommonJS helpers with React. Other dependencies follow their importers,
// allowing PDF and its transitive dependencies to remain genuinely deferred.
export function manualChunks(id) {
  const path = id.replaceAll('\\', '/');
  if (path.includes('commonjsHelpers') || /\/node_modules\/(react|react-dom|scheduler|react-router|react-router-dom|react-window|use-sync-external-store)\//.test(path)) return 'react-vendor';
  if (path.includes('/src/cardData')) return 'card-data';
  if (path.includes('/src/qaData')) return 'qa-data';
}
