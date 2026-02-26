# MCP Server 위젯 개발 규칙 (필독)

OpenAI ChatGPT(또는 Claude 등)의 Apps/MCP 환경에서 커스텀 UI(위젯)를 서비스할 때, 보안 정책 누락으로 인한 리젝/오류가 매우 빈번하게 발생합니다. 새로운 위젯을 추가하거나 수정할 때 **반드시 아래 규칙을 준수**해야 합니다.

## 1. 리소스 등록 시 `_meta` 필수 포함 규칙

위젯 리소스(`ui://widget/...`)를 `server.registerResource`로 반환할 때, 가장 바깥쪽의 설정뿐만 아니라 **반환되는 `contents` 배열 내부 객체에도 반드시 `_meta`가 포함**되어야 합니다. 이것이 누락되면 "이 템플릿에 위젯 CSP가 설정되어 있지 않습니다" 등의 오류가 발생합니다.

### ❌ 잘못된 예시 (CSP 누락 발생)
```javascript
server.registerResource(
  "map-ui",
  "ui://widget/map-ui.html",
  {
    // 여기에만 _meta를 선언하면 에러 발생!
    _meta: {
      ...buildWidgetMeta({ connectDomains: [], resourceDomains: [], frameDomains: [] })
    }
  },
  async () => ({
    contents: [
      {
        uri: "ui://widget/map-ui.html",
        mimeType: RESOURCE_MIME_TYPE,
        text: readFileSync(".../map-ui.html", "utf-8")
        // ❌ _meta 누락!
      }
    ]
  })
);
```

### ✅ 올바른 예시 (필수 형태)
```javascript
server.registerResource(
  "map-ui",
  "ui://widget/map-ui.html",
  {
    _meta: { ...buildWidgetMeta({ ... }) } // 1. 선언부 (옵션)
  },
  async () => ({
    contents: [
      {
        uri: "ui://widget/map-ui.html",
        mimeType: RESOURCE_MIME_TYPE,
        text: readFileSync(".../map-ui.html", "utf-8"),
        _meta: {
          // 2. contents 내부에 반드시 _meta 포함! (필수)
          ...buildWidgetMeta({
            connectDomains: [],
            resourceDomains: [],
            frameDomains: WIDGET_DOMAIN ? [WIDGET_DOMAIN] : []
          })
        }
      }
    ]
  })
);
```

## 2. 도메인 (Domain & CSP) 정책 설정

위젯에서 외부 스크립트, 이미지, Iframe을 불러오거나 백엔드와 통신해야 하는 경우, `_meta` 내부에 정확한 허용 규칙을 선언해야 합니다. 기본적으로 `buildWidgetMeta` 유틸리티 함수를 사용하되, 아래 옵션을 정확히 매핑하세요.

- **`connectDomains`**: `fetch`, `XMLHttpRequest`, 웹소켓 등을 통해 데이터를 주고받을 도메인. (예: 백엔드 API 주소)
- **`resourceDomains`**: `<img>`, `<script>`, `<link>` 태그를 통해 외부 리소스(JS/CSS/이미지)를 로드할 도메인. (예: `["https://dapi.kakao.com", "https://t1.daumcdn.net"]`)
- **`frameDomains`**: `<iframe>`으로 삽입을 허용할 도메인. 지도 삽입(`embed-map.html`)과 같이 앱 자체의 다른 라우트를 아이프레임으로 띄울 경우 **`WIDGET_DOMAIN`을 반드시 배열에 포함**해야 합니다.

## 3. Tool(함수) 등록 시 규칙
`server.registerTool` 내부의 `_meta`에서도 위젯 렌더링에 필요한 CSP 정책을 위와 동일한 형식으로 선언해 주어야 합니다.

```javascript
server.registerTool(
  "some_tool",
  {
    // ...
    _meta: {
      "openai/outputTemplate": "ui://widget/some.html",
      ...(WIDGET_DOMAIN ? { "openai/widgetDomain": WIDGET_DOMAIN } : {}),
      "openai/widgetCSP": {
        connectDomains: [],
        resourceDomains: [],
        frameDomains: [] // Iframe 사용 시 도메인 추가
      }
    }
  },
  // ...
);
```

## 4. `buildWidgetMeta` 헬퍼 함수
`src/server.js`에 정의된 `buildWidgetMeta` 함수를 적극 활용하여, 위젯 도메인과 CSP 메타데이터를 일관성 있게 구성하세요. 새로운 라우트 추가 시 이 구조를 벗어나 하드코딩하지 않도록 주의합니다.
