// "Mật Ong Hoa Vải" → "mat-ong-hoa-vai"
export function slugify(text: string) {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

export const isValidSlug = (slug: string) => /^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug)
