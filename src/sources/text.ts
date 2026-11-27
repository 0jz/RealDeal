/** Lowercase and strip Latin diacritics (č -> c). Cyrillic is left alone on purpose. */
export const normalize = (s: string) => s.toLowerCase().replace(/đ/g, "d").normalize("NFD").replace(/[̀-ͯ]/g, "")

