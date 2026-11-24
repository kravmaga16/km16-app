export function courseCategoryLabel(category) {
 return String(category ?? '').replace(/6[–-][89] ans/g, '5–8 ans').replace(/10[–-]14 ans/g, '9–14 ans');
}
