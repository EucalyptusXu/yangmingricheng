# 阳明日程 · Android 壳工程

这是「阳明日程」的安卓外壳。App 的界面与业务逻辑全部在网页里（`app/src/main/assets/www/`），原生只负责浏览器做不到的三件事：**本地通知、精确闹钟（AlarmManager）、开机后恢复闹钟**。

---

## 直接出 APK（不需要装任何开发环境）

推到这个仓库后：

1. 进 **Actions** 标签页
2. 左侧选 **Build APK** → 右侧 **Run workflow** → 绿色按钮
3. 等 3~5 分钟，变成绿勾
4. 点进那次运行，页面**拉到最下面** → **Artifacts** → 下载 `yangming-schedule-debug`
5. 下载到的是 zip，解开就是 `app-debug.apk`，传到手机安装（需在手机上允许「安装未知来源应用」）

> 推送到任意分支都会自动触发构建，不用手动点。

**Artifacts 需要登录 GitHub 才能下载。** 如果要发给别人、或者想要一个不用登录的下载链接，可以在仓库里新建一个 Release 并把 apk 作为附件传上去。

---

## 装到手机后必做两件事

1. 打开 App → 「我的」页 → 点 **「申请通知权限」**，允许通知
2. 点 **「测试提醒」**，确认通知栏弹出「阳明日程 · 提醒测试」

没弹出来按顺序排查：

- 系统设置 → 应用 → 阳明日程 → 通知：是不是被关了
- 系统设置 → 电池 → 应用启动管理：设为「手动管理」并允许后台活动
  （**国产 ROM 默认会杀后台，这是提醒失效最常见的原因**）
- Android 12+：设置 → 应用 → 特殊权限 → 闹钟和提醒 → 允许
  （不允许也不会丢提醒，只是触发时间会飘几分钟）

---

## 想改 App 内容

**不要直接改 `app/src/main/assets/www/` 里的文件。** 那是从网页源码同步过来的产物，下次同步会被覆盖。

改内容要改网页源码，然后重新同步：

```bash
# 1. 改 ../yangming-schedule/ 下的文件
# 2. 同步
bash ./sync-web.sh
# 3. 提交 assets/www 的变更，然后推
```

**改了网页忘了同步**，是这套结构最容易犯的错——APK 会正常构建成功，但装上去是旧版界面。这个仓库的 workflow 里加了两道校验（`Verify web assets are committed` 和 `Verify the corpus is not empty`），漏提交或提交了旧版 assets 会直接构建失败并给出明确报错，不会让你拿到一个坏包。

### 常见改动位置

| 想改什么 | 改哪 |
|---|---|
| 语录内容、标签 | `../yangming-schedule/js/data/quotes-0*.js` |
| 用户写的词归到哪个标签 | `../yangming-schedule/js/data/lexicon.js` 的 `YM_TAG_ALIAS` |
| 什么时候推律己的话、什么时候推体谅的话 | `../yangming-schedule/js/data/lexicon.js` 的 `YM_THEME_TONE` |
| 界面配色、文案 | `../yangming-schedule/css/style.css`、`index.html` |
| 匹配算法 | `../yangming-schedule/js/matcher.js` |

改完语料跑一下校对：

```bash
node ../yangming-schedule/tools/audit-corpus.js
```

改完代码跑一下测试（107 项断言）：

```bash
cd ../yangming-schedule && node tests/smoke.js
```

---

## 本地构建（可选，需要 JDK 17 + Android SDK）

```bash
bash ./sync-web.sh
gradle assembleDebug
adb install app/build/outputs/apk/debug/app-debug.apk
```

用 Android Studio 的话直接 `Open` 这个目录，然后 Build → Build APK(s)。

---

## 目录说明

```
app/src/main/
├── AndroidManifest.xml
├── java/com/yangming/schedule/
│   ├── MainActivity.kt        WebView 宿主 + YMBridge（JS ↔ 原生）
│   ├── ReminderScheduler.kt   闹钟排程与持久化（整体替换式）
│   ├── ReminderReceiver.kt    到点发通知（正文带一句配对出的语录）
│   └── BootReceiver.kt        重启 / 改时间 / 换时区 / 应用更新后重放存档
├── res/                       主题、图标（朱砂「王」字）、通知图标
└── assets/www/                ← sync-web.sh 的产物，不要手改
```

## 提醒是怎么保证不漏的

网页端每次打开、每次数据变动，都会重算**未来 30 天**的提醒（上限 200 条）并整体覆盖原生闹钟——端上永远只有一份真相，不会残留幽灵通知。原生侧在开机、改时间、换时区、应用更新后都会从 `SharedPreferences` 重放。

所以只要用户一个月内打开过一次 App，提醒就不会断。

## 换签名（要发正式包时）

把 keystore 放到 `keystore/ym.jks`，在 `gradle.properties` 里加：

```properties
YM_STORE_PASSWORD=你的密码
YM_KEY_ALIAS=你的别名
YM_KEY_PASSWORD=你的密码
```

**不要提交 keystore 和密码**（`.gitignore` 里已经排除了 `keystore/` 和 `*.jks`）。真要做 CI 签名，用 GitHub Secrets 传。
