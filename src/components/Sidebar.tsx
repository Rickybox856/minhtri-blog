import type { Child } from 'hono/jsx'
import type { Context } from 'hono'
import { listPosts } from '../lib/db'
import type { Post } from '../lib/db'
import type { AppEnv } from '../types'
import { PostList } from './Cards'

// Cột bên phải trên máy tính (trên điện thoại nằm dưới nội dung):
// mời đăng ký thành viên, chuyên mục, bài mới, diễn đàn
type SidebarData = { recent: Post[] }

export const sidebarData = async (c: Context<AppEnv>): Promise<SidebarData> => ({
  recent: await listPosts(c.env.DB, 5),
})

const Sidebar = ({ c, data, currentCategory }: { c: Context<AppEnv>; data: SidebarData; currentCategory?: string }) => {
  const member = c.get('member')
  return (
    <aside class="sidebar" aria-label="サイドバー">
      {member ? (
        <div class="side-box side-member">
          <h2>会員メニュー</h2>
          <p>すべての音声をお楽しみいただけます。</p>
          <a class="btn" href="/thanh-vien">マイページ</a>
        </div>
      ) : (
        <div class="side-box side-member">
          <h2>無料会員登録</h2>
          <p>テレフォン人生相談の音声がすべて聴けます。登録はメールアドレスとパスワードだけ。</p>
          <a class="btn" href="/thanh-vien/dang-ky">無料で会員登録</a>
          <a class="side-login" href="/thanh-vien/dang-nhap">ログインはこちら</a>
        </div>
      )}

      <div class="side-box">
        <h2>カテゴリー</h2>
        <ul class="side-cats">
          {c.get('nav').postCategories.map((cat) => (
            <li>
              <a href={`/chu-de/${cat.slug}`} class={cat.slug === currentCategory ? 'active' : undefined}>
                {cat.name}
              </a>
            </li>
          ))}
        </ul>
      </div>

      {data.recent.length > 0 && (
        <div class="side-box">
          <h2>新着記事</h2>
          <PostList posts={data.recent} />
        </div>
      )}

      <div class="side-box side-forum">
        <h2>みんなの相談広場</h2>
        <p>悩みや気づきを、みんなで分かち合う掲示板です。</p>
        <a class="btn btn-outline" href="/dien-dan">相談広場へ</a>
      </div>
    </aside>
  )
}

/** Nội dung chính + sidebar: hai cột trên máy tính, một cột trên điện thoại */
export const WithSidebar = (props: { c: Context<AppEnv>; data: SidebarData; currentCategory?: string; children?: Child }) => (
  <div class="with-sidebar">
    <div class="main-col">{props.children}</div>
    <Sidebar c={props.c} data={props.data} currentCategory={props.currentCategory} />
  </div>
)
