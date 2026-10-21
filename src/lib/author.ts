// Dữ liệu có cấu trúc (schema.org) về tác giả, giúp Google hiểu trang nói về ai.
// Thông tin lấy từ nguồn công khai (Wikipedia, NDL); sửa ở đây nếu cần cập nhật.

export const AUTHOR_PAGE_SLUG = 'gioi-thieu'

export const authorPerson = {
  '@type': 'Person',
  name: '加藤諦三',
  alternateName: ['かとう たいぞう', 'Taizo Kato'],
  birthDate: '1938-01-26',
  birthPlace: { '@type': 'Place', name: '東京都' },
  jobTitle: '社会心理学者',
  description: '社会学者・心理学者・評論家。早稲田大学名誉教授。ニッポン放送「テレフォン人生相談」で1972年からパーソナリティを務める。',
  affiliation: { '@type': 'CollegeOrUniversity', name: '早稲田大学' },
  alumniOf: { '@type': 'CollegeOrUniversity', name: '東京大学' },
  award: ['ギャラクシー賞（1976年）', '東京都功労者表彰（2009年）', '瑞宝中綬章（2016年）'],
  sameAs: ['https://ja.wikipedia.org/wiki/%E5%8A%A0%E8%97%A4%E8%AB%A6%E4%B8%89', 'https://id.ndl.go.jp/auth/ndlna/00028058'],
}

/** Trang giới thiệu tác giả: trang web nói về (about) ông Kato */
export const authorPageJsonLd = (url: string) => ({
  '@context': 'https://schema.org',
  '@type': 'AboutPage',
  url,
  inLanguage: 'ja',
  about: authorPerson,
  mainEntity: authorPerson,
})

/** Danh sách sách của tác giả trên trang sản phẩm */
export const booksJsonLd = (books: { name: string; url: string; image?: string; description?: string }[]) => ({
  '@context': 'https://schema.org',
  '@type': 'ItemList',
  itemListElement: books.map((b, i) => ({
    '@type': 'ListItem',
    position: i + 1,
    item: {
      '@type': 'Book',
      name: b.name,
      url: b.url,
      image: b.image,
      description: b.description,
      inLanguage: 'ja',
      author: { '@type': 'Person', name: authorPerson.name },
    },
  })),
})
