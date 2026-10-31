# ACG 面接用デプロイ

## 公開状態

- 面接ラベル: `interview-001`（ログインIDではなく、DB上のデータ領域の管理名）
- 公開URL: https://acg-react-interview-001.netlify.app/
- Netlify deploy: `6ae54d5a552e8305cd4eac07`、state `ready`
- Netlifyビルド変数: 面接Supabaseの `VITE_SUPABASE_URL` と公開用 `VITE_SUPABASE_ANON_KEY` をproduction/buildsに設定済み。service-role keyは設定しない。
- Authの新規登録: OFF（Supabase Auth settings APIで `disable_signup=true` を確認）
- 面接ログイン: `interview-001@example.invalid`。Supabase Adminで作成・メール確認済み、新規登録フォーム経由ではない。`interview-001` の通常memberとして有効化し、3サイトで共通利用する。`.invalid` は受信不能な予約ドメインのため、メールによるパスワード再設定はできない。

未ログインでは `/login` を表示することを実ブラウザーで確認済み。Netlifyのサイトパスワード/SSO保護は設定していないため、静的HTML・JavaScript・公開画像はURLを知る人が取得できる。アプリ内ログインは静的配布物を隠す機能ではない。

## データ境界

共有Supabaseは面接専用プロジェクト `ouqvnabeiwjysuvehmrq`。本番Supabase `nnthvbizvqpufpfkzlho` は変更しない。DBにはactive tenant `interview-001` とread-only seedがあり、各tenantに仮名化プロフィール18件、イベント7件、公開ACGデッキ6件を用意した。Authユーザー/セッションと本番のpreview-card画像は移していない。

面接プロジェクトの全public app tableでRLSとFORCE RLSが有効。Storage bucketは0件。preview-card画像60件は本番Storageを参照していたため移さず、面接版ではプレビューカード管理画面を無効化している。直接RESTのA/B検査では、双方が自分のプロフィール1件だけを読み、相手tenantの読み取り・更新は0行になることを確認した。一時tenantとprobe userは検査後に削除済み。

MyPageのメール/パスワード変更操作は共有Authアカウントを守るためUIで無効化している。これは認可設定ではなく、Supabase Auth側の資格情報更新を禁止するものでもない。MyPageに権限付与機能は置かない。

## ビルドと再デプロイ

`.env.local` はローカル専用でGit管理しない。Netlifyのビルド環境変数も上記の公開値で構成済み。再デプロイ時はこの面接用Netlify site IDだけを指定すること。本番site IDや本番Supabaseの値を使わない。

面接終了時は、このsiteとAuthアカウントを停止し、このtenantの行だけを削除する。共通seedや他の面接tenantは残す。自動期限は設定しない。
