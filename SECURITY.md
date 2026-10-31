# 認証情報の管理

秘密キー・平文パスワード・サービス権限キーをソース、文書、テスト、ログへ保存しない。
公開用 Supabase キーは秘密ではない。データの境界は Supabase Auth と RLS で守る。
ブラウザの固定パス画面は利用者向けの入口であり、DB の認可を代替しない。
2026-10-30 の方針により固定パスと照合方法は維持する。

## ローカルと CI

初回 clone 後に `npm run security:install` を実行し、pre-push を有効にする。
既存の独自 hook がある場合は上書きせずエラーになる。その hook から
`node scripts/security/secrets.mjs pre-push` に Git の標準入力を渡す形で統合する。

- `npm run security:scan`: ローカルで取得済みの全参照・全履歴を検査。
- `npm run security:test`: 秘密を削除した履歴、別ブランチの push、除外境界、実際の hook 拒否を検証。
- pre-push: 送信する参照のコミット範囲を検査。新規参照・未知の送信先基点は送信側の全履歴を検査。
- GitHub Actions `Secret scan`: push / pull request の取得可能な全履歴を検査。

Gitleaks 8.30.1 の公式配布物を固定 SHA256 で照合して一時キャッシュに配置する。
Windows x64 / Linux x64 と Node.js 22 をサポートする。ネットワークや検査器の失敗時は push を止める。
オフラインでは同じ版の信頼できる実行ファイルを `GITLEAKS_BINARY` で指定できる。
ログに出すのはルール・ファイル・行・コミットのみで、検出値や元行は出さない。

`.gitleaks.toml` の例外は公開用キー形式と確認済みの配置先の両方に一致する場合だけ。
ファイル全体、任意の高エントロピー値、未知の検出をまとめて除外しない。
`.gitleaksignore` と `gitleaks:allow` コメントでの黙示除外は使用しない。

## 検出時

push を止め、値をチャットや issue に貼らず、ファイル・行・種類だけを共有する。
本物なら失効・再発行を先に行い、環境設定へ移す。履歴削除だけでは失効しない。
誤検出なら公開仕様と利用箇所を確認し、限定した例外と回帰テストを追加する。

2026-10-30 の監査では取得可能なリモート履歴から実秘密の混入は確認されなかった。
これは不存在の保証ではない。未取得参照、Git 管理外の環境変数、バイナリ内部等は別の範囲である。
固定パスの変更と GitHub 有料機能の契約変更はこの対応に含めない。

参考: [Gitleaks](https://github.com/gitleaks/gitleaks/tree/v8.30.1)、
[Supabase API keys](https://supabase.com/docs/guides/api/api-keys)、
[Row Level Security](https://supabase.com/docs/guides/database/postgres/row-level-security)。

## DB 権限の実測（2026-10-30）

`rls-smoke.sql` を DB 管理者の接続から一括実行し、SQL の `anon` / `authenticated`
と利用者 ID を切り替えて確認した。テストは全て成功し、最後に ROLLBACK した。
別の読み取りでもテスト用 profiles / decks / events が 0 件であることを確認した。

- 未ログイン: 非公開・公開デッキの読取とデッキ追加を拒否。
- 一般利用者: 自分のデッキ操作と公開デッキ読取は許可。他人の非公開デッキ読取・更新・削除と所有者変更は拒否。
- 一般利用者: 管理者向けイベント追加・更新・削除と、プロフィールの role を admin にする挿入・更新を拒否。
- 管理者: イベント追加・更新・削除を許可する正の対照も成功。

BS / ACG の直接テーブル操作を確認した範囲で、今回のためのポリシー変更は不要だった。
HTTP の JWT 検証、ブラウザログイン、全 RPC・Storage の認可を網羅するテストではない。
公開プロフィール・イベントの既存公開方針と固定パスは変更していない。
再実行時は `scripts/security/rls-smoke.sql` を一括で使い、部分実行や COMMIT への変更をしない。
