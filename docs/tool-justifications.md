# Tool Annotation Justifications

이 문서는 앱 제출 화면의 Tool justification 입력란에 그대로 붙여넣기 위한 문구 모음입니다.

## get_districts

### Read Only (True)
This tool only returns a predefined mapping of supported district names and district codes from server-side static data. It does not write to any database, file system, or external service.

### Open World (False)
This tool does not access the internet, third-party APIs, or user-provided external systems. It only reads from a fixed internal dataset bundled with the server.

### Destructive (False)
This tool has no mutation path and cannot delete, overwrite, or alter any data. It is purely a lookup/read operation.

## search_apartment_metadata

### Read Only (True)
This tool performs read-only metadata queries against the existing real-estate dataset and returns matching apartment metadata. It does not create, update, or delete records.

### Open World (False)
This tool is restricted to the server’s internal real-estate database and does not browse or interact with arbitrary external resources. Its scope is limited to the app’s managed dataset.

### Destructive (False)
The implementation executes retrieval-only logic and returns results. It does not perform destructive actions or state-changing operations.

## search_realestate_trends

### Read Only (True)
This tool reads aggregated historical transaction trend data and formats a textual trend summary/chart. It does not modify data sources or server state.

### Open World (False)
This tool only queries the app’s internal stored dataset for supported regions/time ranges. It does not call open web resources or external user-controlled systems at runtime.

### Destructive (False)
This tool is analytic/read-only and has no delete or update behavior. It cannot remove or alter records.

## get_latest_transaction_examples

### Read Only (True)
This tool fetches recent sale transaction examples from stored data and returns them as results. It does not write or mutate any persistence layer.

### Open World (False)
This tool operates within the app’s bounded internal data domain and does not access arbitrary external entities or internet endpoints during tool execution.

### Destructive (False)
This tool has no destructive code path. It only reads and returns transaction examples.

## get_latest_rent_examples

### Read Only (True)
This tool retrieves recent rent transaction examples from existing stored records. It performs no insert/update/delete actions.

### Open World (False)
This tool is limited to internal rent transaction data managed by the app and does not interact with open-world external systems during execution.

### Destructive (False)
This tool is non-destructive by design and implementation; it only returns queried rent examples without altering data.
