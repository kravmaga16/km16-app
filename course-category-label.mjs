export function courseCategoryLabel(category) {
 return String(category ?? '').replace(/10[–-]14 ans/g, '9–14 ans');
}
