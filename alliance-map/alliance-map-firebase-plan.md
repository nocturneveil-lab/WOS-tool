# Alliance Map:Web保存・リアルタイム同期・3段階権限 実装プラン

対象:`alliance-map/index.html`(単一HTML、IIFE構成の素のJS)、`alliance-map/default-layout.json`、`alliance-map/README.md`

## 0. 目的

- 現状は、起動のたびに `default-layout.json` を読み込むだけで、マップを更新するには「JSON保存 → ファイル差し替え → push」が必要。この運用を廃止し、**Firebase(Cloud Firestore、Sparkプラン)にマップを保存して全員の画面にリアルタイム同期する**。
- 権限は **閲覧/編集(保存不可)/編集(保存可能)** の3段階とする。
- 自動保存に加え、**履歴(スナップショット)からの復元**と**名前付き保存**を用意する。
- ビルドツールは導入しない。GitHub Pagesにpushするだけで動く構成を維持する。

## 1. 先に修正する既存バグ(必須)

`applyLayout()` 内の `setViewCenter(nextCenter);` で、未定義の変数 `nextCenter` を参照している。strictモードのため ReferenceError となり、`default-layout.json` の読み込みが毎回失敗する。状態を一部書き換えたあと、`render()` の前で例外が発生している。

- `view.center` を検証したうえで `nextCenter` を定義する。`x` と `y` が有限数でない場合は `{x:0, y:0}` とする。
- `applyLayout` は、すべての検証を終えてから状態を書き換える構造にする。途中で例外が起きても状態が壊れないようにするため。

## 2. 技術構成

- Firebase JS SDK(modular版)を gstatic のCDNからESモジュールとして読み込む。**バージョンは 13.0.0 に統一する**(app、auth、firestore のすべて)。
  - `https://www.gstatic.com/firebasejs/13.0.0/firebase-app.js`
  - `https://www.gstatic.com/firebasejs/13.0.0/firebase-auth.js`
  - `https://www.gstatic.com/firebasejs/13.0.0/firebase-firestore.js`
- Firebase関連の処理は、新規ファイル `alliance-map/cloud.js`(`<script type="module">`)に分離する。既存のIIFEは `window.AllianceMapApp` として、次のような小さなAPIを公開する。`CustomEvent` を併用してもよい。
  - `getLayout()`
  - `applyLayout(layout, {source})`
  - `setRole(role)`
  - `onLocalChange(cb)` など
- `cloud.js` の先頭に置く定数は次のとおり。apiKey は公開してよい値なので、そのままコミットしてよい。

```js
const FIREBASE_CONFIG = {
  apiKey: "AIzaSyDq9vYAx3tiqBhNeJL0tWv0I4xyDvDeJ1Y",
  authDomain: "alliance-map-fbbf6.firebaseapp.com",
  projectId: "alliance-map-fbbf6",
  storageBucket: "alliance-map-fbbf6.firebasestorage.app",
  messagingSenderId: "378934098264",
  appId: "1:378934098264:web:e884dcd6475bf709b18d2d"
};
// 編集(保存不可)用の共有アカウント。合言葉=このアカウントのパスワード
const EDITOR_EMAIL = "editor@alliance-map.app";
// 保存可能アカウントのメールは「アカウント名 + このドメイン」で内部生成する
const SAVER_EMAIL_DOMAIN = "saver.alliance-map.app";
```

## 3. 権限設計

| 権限 | ログイン方法 | できること |
|---|---|---|
| 閲覧(viewer) | なし(URLを開くだけ) | 表示、ズーム、パン、PNG/SVG出力。Web上の最新状態がリアルタイムで反映される |
| 編集・保存不可(editor) | **合言葉のみ** | 現行の編集操作をすべて使える。**変更は自分のブラウザ内だけ**で、Webには保存されない。履歴の閲覧とプレビューができる |
| 編集・保存可能(saver) | **アカウント名 + 合言葉** | 編集内容をWebへ自動保存する。履歴からの復元、名前付き保存、共有設定(色、マップサイズ、熊罠の文字サイズ、初期表示)の保存、JSONのバックアップと読み込みができる |

### 認証方式

ユーザーにメールアドレスは一切見せない。内部では Firebase Authentication の「メール/パスワード」方式を使う。

- **editor(合言葉のみ)**:共有アカウントを1つ作る(`EDITOR_EMAIL`)。入力された合言葉をパスワードとして `signInWithEmailAndPassword(EDITOR_EMAIL, 合言葉)` を実行する。
- **saver(アカウント名 + 合言葉)**:管理者が1人に1アカウントを発行する。入力されたアカウント名を `trim().toLowerCase()` で整形し、`{アカウント名}@{SAVER_EMAIL_DOMAIN}` という形のメールアドレスに変換してログインする。
  - アカウント名は**半角英小文字・数字・`_`・`-` の1〜20文字**に制限する(正規表現 `^[a-z0-9_-]{1,20}$`)。条件を満たさない入力は、送信前にエラーを出す。
  - 合言葉はFirebaseの仕様上、**6文字以上**が必要。ダイアログにもその旨を表示する。
- ログインダイアログ
  - 「編集(合言葉)」と「編集・保存(アカウント名+合言葉)」をタブで切り替える。
  - 合言葉の入力欄は `type="password"` とする。
  - アカウント名は localStorage に記憶し、次回から入力済みにする。合言葉は保存しない。
- ログイン状態は `browserLocalPersistence` で保持する。ヘッダーには、現在の権限バッジ(閲覧/編集/保存可:アカウント名)とログイン・ログアウトのボタンを表示する。
- ロールの判定(`auth.currentUser.email` で行う)
  - `EDITOR_EMAIL` と一致する場合は editor とする。
  - `@SAVER_EMAIL_DOMAIN` で終わる場合は saver とし、`@` より前をアカウント名として扱う。
  - どちらにも当てはまらない場合はログアウトし、viewer として扱う。
- 履歴の作成者と最終更新者には、**saver のアカウント名を自動で記録する**。ニックネームの入力欄は設けない。
- 設定ダイアログ(saver のみ)に「自分の合言葉を変更」を設け、`updatePassword` で変更する。`auth/requires-recent-login` が出た場合は、再ログインを促す。
- ログイン失敗時のメッセージは、どの場合も「アカウント名または合言葉が違います」に統一する(エラーの種類を外部に見せないため)。
- 権限の強制のしかた
  - **書き込み権限は Firestore のセキュリティルールで強制する**(5.を参照)。
  - editor と viewer の違いは UI 上の制御だけでよい(editor は保存を行わないため)。

### UI上の権限制御

- viewer
  - 次の操作を非表示にする:配置ツール、編集モード切替、ひとつ戻る、リセット、ファイル保存と読み込み、色・マップサイズの設定。
  - 文字サイズスライダー(個人の表示設定)と画像出力は残す。
- editor
  - 現行のUIをすべて表示する。ただし、ファイル保存と読み込みは除く。
  - 最初に変更した時点から、画面上部に「ローカル編集中(保存されません)」の帯と**[最新に戻す]**ボタンを表示する。
- saver
  - すべてを表示する。
  - 加えて、**保存状態の表示**(「保存済み 09:20」「保存中…」「保存失敗 [再試行]」「オフライン」)と、**[履歴]**ボタンを表示する。

## 4. Firestoreのデータ構造

```
maps/main                      ← 現在のマップ(1ドキュメント)
  format: "alliance-map-layout"
  version: 1
  classifications: {...}
  placements: [...]
  objectColors: {...}
  bearTrapLabelSize: number
  view: { center:{x,y}, zoom, mapCols, mapRows }
  updatedAt: serverTimestamp
  updatedBy: string(アカウント名)
  rev: number(保存のたびに +1)

maps/main/history/{autoId}     ← 履歴
  kind: "before-edit" | "before-restore" | "named"
  name: string(named のみ、最大30文字)
  layout: { ...maps/main と同じ形式のマップ本体... }
  createdAt: serverTimestamp
  createdBy: string(アカウント名)
```

- レイアウトの形式は、現行の「ファイルに保存」が出力するJSONと同一とする。Firestoreから受信した場合も `applyLayout` で検証してから適用する。
- `view`(中心とズーム)は**初回表示時にだけ適用する**。リアルタイム受信時は `view` を無視し、他の人の表示位置が勝手に動かないようにする。初期表示を変えたい場合は、saver が設定ダイアログの「現在の表示を初期表示にする」で明示的に保存する。
- 色、マップサイズ、熊罠の文字サイズは**共有設定**とし、Webの値を優先する。viewer と editor が変更した場合は、ローカルにだけ反映する。

## 5. セキュリティルール(`firestore.rules` としてリポジトリにも置く)

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    function isSaver() {
      return request.auth != null
        && request.auth.token.email.matches('^[a-z0-9_-]+@saver[.]alliance-map[.]app$');
    }
    match /maps/{mapId} {
      allow read: if true;
      allow write: if isSaver();
      match /history/{historyId} {
        allow read: if true;
        allow create, update, delete: if isSaver();
      }
    }
  }
}
```

- 保存可能アカウントは、ドメインのパターンで判定する。アカウントを追加・削除してもルールを変更する必要はない。
- editor の共有アカウント(`editor@alliance-map.app`)はパターンに一致しないため、書き込めない。
- コンソールで新規登録(サインアップ)を無効にしているため、管理者が作成した以外のアカウントは存在しない。

## 6. 読み込みと同期の仕様

1. 起動時に `maps/main` を `onSnapshot` で購読する。
   - 初回のスナップショットは `view` を含めて適用し、`zoomBase` を設定する(現行の `loadPublishedLayout` と同じ扱い)。
   - 2回目以降は `view` を除いて適用する。
2. **フォールバック**
   - 接続エラーの場合、または `maps/main` が存在しない場合は、`default-layout.json` を読み込み、「オフライン表示」であることを明示する。
   - `maps/main` が存在せず、かつ saver でログインしている場合は、「公開用の配置をWebに登録」ボタンを表示し、初回移行に使えるようにする。
3. スナップショットを受信したときの扱い
   - viewer:常に即時適用する。
   - editor:ローカルで変更していなければ即時適用する。変更があれば適用を保留し、帯に「Webで更新がありました [最新に戻す]」と表示する。
   - saver:`metadata.hasPendingWrites` が true のもの(自分の書き込みの反映)は無視する。ドラッグ中や名前入力中に受信した場合は、操作が終わってから適用する。
4. **自動保存(saverのみ)**
   - 既存の `markLayoutChanged()` の呼び出し箇所を変更検知に使う。最後の変更から1秒後に、まとめて `setDoc(maps/main)` を実行する(デバウンス)。`rev` は `increment(1)` で更新する。
   - 保存直前に `rev` を比較する。他の人の保存と衝突していたら「他の人が先に更新しました」と通知したうえで、自分の内容で上書きする(後から保存した側が優先)。上書きされた内容は、7.の before-edit の履歴から復元できる。
   - 「ひとつ戻る」とリセットも、通常の変更として自動保存の対象にする。
   - `beforeunload` での離脱警告は、saver では保存待ちがあるときに出す。editor ではローカルに変更があるときに出す。viewer では出さない。
5. JSONファイルの読み込み(saverのみ)は、適用すると自動保存の対象になる。読み込む前に「Webのマップを置き換えます」と確認する。

## 7. 履歴

- **編集開始前(before-edit)**:saver が変更を保存する直前に記録する。条件は「このクライアントで最後に変更してから10分以上経っている」または「セッション内で初めての変更」。記録するのは**変更前の状態**で、`rememberMapState` の直前の状態から取る。
- **復元前(before-restore)**:復元を実行する直前に、現在の状態を記録する。
- **名前付き保存(named)**:履歴画面の「現在の状態に名前を付けて保存」から作成する。自動削除の対象外とし、上限は20件とする。
- 自動の履歴(before-edit と before-restore)は**最新30件**だけを残す。追加したあとに、古いものを削除する。
- 履歴ダイアログ
  - 一覧の並び:名前付き保存(★)を先頭にまとめ、そのあとに自動の履歴を新しい順に並べる。各項目に、種別・日時・作成者を表示する。
  - [プレビュー]:**自分の画面にだけ**表示する。この間はスナップショットの適用を止める。上部の帯に「プレビュー中 [この状態に復元] [プレビューを終了]」を表示する。復元は saver だけが行える。
  - [復元]:saver のみ。確認ダイアログを出し、before-restore を記録してから `maps/main` に書き込む。
  - [名前変更]・[削除]:saver のみ。名前付き保存の項目が対象。
- 履歴の取得は、ダイアログを開いたときに `getDocs` を1回だけ実行する(リアルタイム購読はしない)。

## 8. ドキュメント

- `alliance-map/README.md` を次の内容に書き換える。
  - 新しい運用:マップの更新にpushは不要になったこと。
  - Firebaseの設定と、アカウントの管理方法(9.)。
  - フォールバック時の挙動。
- `default-layout.json` は、オフライン時の表示と初回移行のために残す。
- リポジトリ内のテスト用ファイル(`firebase-test.html` など)は削除する。

## 9. アカウント管理(READMEに記載すること)

| 操作 | 手順 |
|---|---|
| 編集の合言葉を設定 | Authentication →「ユーザー」→「ユーザーを追加」。メールに `editor@alliance-map.app`、パスワードに合言葉(6文字以上)を入力する |
| 編集の合言葉を変更 | 上記のユーザーを削除し、同じメールアドレスで新しい合言葉を設定して作り直す |
| 保存可能な人を追加 | 「ユーザーを追加」。メールに `{アカウント名}@saver.alliance-map.app`(アカウント名は半角英小文字・数字・`_`・`-`)、パスワードにその人の合言葉を入力する |
| 保存可能な人を削除 | その人のユーザーを削除する(最大1時間で書き込めなくなる) |
| 保存可能な人の合言葉を変更 | 本人がアプリの設定から変更する。忘れた場合は、管理者がユーザーを削除して同じアカウント名で作り直す |

初期設定(済みの項目は飛ばしてよい)

- メール/パスワード方式を有効にする。
- 新規登録(作成)を無効にする。
- 承認済みドメインに `nocturneveil-lab.github.io` を追加する。
- Firestore を作成する(`asia-northeast1`)。
- 5.のルールを公開する。
- push後、saver としてログインし、「公開用の配置をWebに登録」を押す。

## 10. 実装の進め方と確認

- 次の順で、小さくコミットする。
  1. 既存バグの修正
  2. IIFEのAPI化
  3. `cloud.js` の追加と、閲覧の同期
  4. ログインと3段階の権限
  5. 自動保存
  6. 履歴
  7. README
- Firebaseに接続できない場合でも、現行と同等に動作することを各ステップで確認する。
- 確認項目
  - [ ] viewer で、編集系のUIが表示されない。別の端末で保存した内容が1〜2秒で反映される。
  - [ ] editor(合言葉のみ)で編集しても、Webの内容が変わらない。[最新に戻す]でWebの状態に戻る。
  - [ ] saver(アカウント名+合言葉)で、配置・移動・消去・名前変更・ひとつ戻る・リセットが自動保存される。履歴に、その人のアカウント名が残る。
  - [ ] editor アカウントで、開発者ツールから直接書き込もうとすると、ルールで拒否される。
  - [ ] before-edit が10分間隔で作られ、30件を超えると古いものから削除される。
  - [ ] プレビューが他の人の画面に影響しない。復元した場合も、復元前の状態に戻せる。
  - [ ] スマホのタッチ操作(長押し・ドラッグ・ピンチ)が壊れていない。
