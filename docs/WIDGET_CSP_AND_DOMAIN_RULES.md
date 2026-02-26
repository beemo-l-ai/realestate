# MCP Apps 위젯 개발 규칙 (필독)

OpenAI ChatGPT Apps SDK에서 커스텀 위젯을 개발할 때 반드시 준수해야 할 규칙입니다.
공식 문서: https://developers.openai.com/apps-sdk/build/mcp-server

## 1. 핵심 원칙: `_meta.ui.resourceUri` 필수

> **위젯이 렌더링되지 않는 가장 흔한 원인**: Tool `_meta`에 `ui: { resourceUri }` 누락

ChatGPT는 `_meta.ui.resourceUri`로 tool → widget template 매핑을 결정합니다.
`openai/outputTemplate`은 **호환성 alias**일 뿐이므로 반드시 **둘 다** 설정하세요.

```javascript
// ✅ 올바른 Tool 등록
server.registerTool("my_render_tool", {
  _meta: {
    ui: { resourceUri: "ui://widget/my.html" },          // ← 필수 (MCP Apps 표준)
    "openai/outputTemplate": "ui://widget/my.html",       // ← 호환성 (ChatGPT alias)
    "openai/toolInvocation/invoking": "로딩 중...",
    "openai/toolInvocation/invoked": "완료"
  }
}, handler);
```

```javascript
// ❌ 잘못된 예시 — 위젯이 렌더링되지 않음!
server.registerTool("my_tool", {
  _meta: {
    "openai/outputTemplate": "ui://widget/my.html",  // ui.resourceUri 없음!
  }
}, handler);
```

## 2. 공식 헬퍼 함수 사용

`@modelcontextprotocol/ext-apps/server`의 공식 헬퍼를 사용하세요:

```javascript
import {
  RESOURCE_MIME_TYPE,
  registerAppResource,
  registerAppTool
} from "@modelcontextprotocol/ext-apps/server";
```

## 3. 리소스 등록 패턴

`registerAppResource()`를 사용하고, `contents` 내부 `_meta.ui`에 `domain`과 `csp`를 설정합니다.

```javascript
registerAppResource(
  server,
  "my-widget",
  "ui://widget/my.html",
  {},   // config (보통 빈 객체)
  async () => ({
    contents: [{
      uri: "ui://widget/my.html",
      mimeType: RESOURCE_MIME_TYPE,    // "text/html;profile=mcp-app"
      text: readFileSync("public/my.html", "utf-8"),
      _meta: {
        ui: {
          domain: WIDGET_DOMAIN,       // ngrok/배포 도메인
          csp: {                        // iframe/외부 리소스 사용 시
            connectDomains: [],
            resourceDomains: [],
            frameDomains: []
          }
        }
      }
    }]
  })
);
```

## 4. CSP (Content Security Policy) 설정

위젯에서 외부 리소스를 로드할 때 `_meta.ui.csp`에 선언합니다.

| 키 | 용도 | 예시 |
|----|------|------|
| `connectDomains` | fetch, XHR, WebSocket 대상 | `["https://api.example.com"]` |
| `resourceDomains` | img, script, link 태그 대상 | `["https://cdn.example.com"]` |
| `frameDomains` | iframe 삽입 대상 (지도 등) | `["https://map.kakao.com"]` |

⚠️ `frameDomains`는 앱 심사 시 추가 검토 대상이므로 필수적인 경우에만 사용하세요.

## 5. Tool 응답에서 `_meta` 사용

Tool 응답의 `_meta`는 위젯 전용 데이터입니다 (모델에 전달되지 않음).
위젯 렌더링 시 `structuredContent`가 위젯으로 전달됩니다.

```javascript
async (args) => ({
  content: [{ type: "text", text: "결과 텍스트" }],       // 모델이 읽는 텍스트
  structuredContent: { key: "value" },                      // 위젯에 전달되는 데이터
  _meta: {}                                                  // 위젯 전용 (모델 미전달)
})
```

## 6. 체크리스트 (새 위젯 추가 시)

- [ ] `registerAppResource()`로 리소스 등록 완료?
- [ ] `contents[].mimeType`이 `RESOURCE_MIME_TYPE`?
- [ ] `contents[]._meta.ui.domain` 설정?
- [ ] Tool `_meta.ui.resourceUri`와 `openai/outputTemplate` 모두 설정?
- [ ] 외부 리소스 사용 시 `_meta.ui.csp` 설정?
- [ ] Widget HTML에서 `ui/notifications/tool-result` 리스너 구현?
