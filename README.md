# JSON formatter

A single-page JSON formatter, hosted on GitHub Pages.

It also expands JSON that sits inside string values, which is common in log entries:

```json
{"body": "SubmitPayout request: {\"RequestType\":\"PAYOUT\",\"Data\":{\"amount\":3026.00}}"}
```

becomes

```
{
  "body": "SubmitPayout request: " + {
    "RequestType": "PAYOUT",
    "Data": {
      "amount": 3026.00
    }
  }
}
```

- A string that is entirely JSON is replaced by the formatted value.
- A string with text around the JSON shows the text and the JSON joined by `+`.
- JSON that was escaped twice, such as `Response : "{\"code\":200}"` inside a string value, is expanded too.
- Input that is not one JSON document, such as a raw log line, has every JSON object or array in it formatted.
- Numbers keep their original text, so `3026.00` and large IDs are not rounded.

Everything runs in the browser. The page loads no external scripts and sends nothing over the network.

## Sharing

**Share**, in the log viewer and the formatter, sends the current view to someone else. Every option opens the same view: list or flow, filters, open entries and sort order.

- **Copy short link** gives a link of about 100 characters. The browser compresses the data, encrypts it with AES-GCM under a random key, and stores the ciphertext on [jsonblob.com](https://jsonblob.com), a free public service. The link holds the blob id and the key, after `#s=`. Browsers never send the part after `#` to a server, so jsonblob.com sees only ciphertext. jsonblob.com decides how long a blob lives; the dialog shows the expiry date when the service reports one.
- **Copy full link** compresses the data into the link itself, with no server involved. Chat apps cut off very long links, so this suits up to about a hundred entries.
- **Download as HTML file** saves a copy of this page with the data inside. It opens in any browser, offline too, and suits large exports.

You can share only the entries that match the current filters. Sensitive values are masked by default: passwords, tokens, secrets, account numbers, names, emails and phone numbers, including inside escaped JSON and query strings, plus anything that looks like a JWT. Masking matches field names, so check the shared view before sending it.

## Source strip

When the JSON is a log entry, a strip above the output shows where it came from: `Application`, `Module`, `TransactionId`, `MerchantId`, service name, environment and version. Grafana's flattened column names such as `attributes_Module` work too.

## Log viewer

The **Log viewer** tab opens a Grafana logs panel CSV export, a JSON array of log entries, or newline-delimited JSON. Choose the file or drop it anywhere on the page.

- Entries are sorted by timestamp (the `tsNs` column when present). Each row shows the time and the gap since the previous entry, and gaps of 250 ms or more are highlighted.
- The summary lists the application, service, environment and version, plus transaction and merchant IDs, modules, traces, log types and severities. Clicking any of them filters the list.
- Opening an entry shows its message with the embedded JSON formatted, then its fields grouped as entry, attributes, resources and Grafana labels. Fields that are the same in every entry are hidden from each entry and listed once in the summary.
- Exceptions and errors are flagged even when logged at Information level. An exception is found from a .NET exception type or stack trace in the message text (not inside JSON payloads), or from OpenTelemetry `exception.type` and `exception.message` attributes. Severity Error or Fatal, or message text with "error" or "failed", counts as an error. **Problems** in the summary filters to them, and stack traces highlight the app's own frames.
- **Prev** and **Next**, or the `k` and `j` keys, step through the entries one at a time.
- Each entry can be copied as JSON or opened in the formatter.
- **Flow** draws the entries as a sequence diagram between Merchant, PayFuture and Provider, using the `LogType` attribute (`API-MerchantRequestReceived`, `API-MerchantResponseSent`, `API-GatewayRequestSent`, `API-GatewayResponseReceived`, `API-GatewayWebhookReceived`, `API-MerchantCallbackSent`). Each response is paired with its request in the same trace to show the round-trip time and any status code. Log lines between calls collapse into an "internal steps" marker, and pauses of 2 s or more are marked. Hovering over an arrow shows its payload, formatted, in a popover. Clicking an arrow opens that entry, and **Back to flow** returns to the same spot in the diagram. Exceptions and errors appear as red and amber markers, and failed responses (4xx, 5xx, Unauthorized and similar) as red arrows. For integration modules that never log a `LogType`, calls are inferred from "...request: {...}" and "...response..." messages and marked "inferred".

## Timeline from Grafana

The page cannot query Grafana itself: Grafana sends no CORS headers, refuses to be framed, and its login cookie is not sent to other sites. A bookmarklet runs the queries from a logged-in Grafana tab instead.

1. Drag **Trace in formatter** from the Log viewer's open-file page to the bookmarks bar. The bookmark loads [`grafana.js`](grafana.js) from this site into the current tab.
2. On `grafana.payfuture.net`, click it, enter a transaction ID or a 32-character trace ID, and pick the environment (`ig-prod`, `ig-qa`, `ig-uat`, `ige-prod`, `ige-qa`, `ige-uat`, mapped to Grafana orgs 6, 3, 5, 7, 2 and 4).
3. `grafana.js` searches Loki for the ID across all services, one day per query. An `INV...` ID ends in its creation time in ms, so the search runs from 15 minutes before that time to 3 days after it. It collects every `traceid` on the matching lines, fetches each trace from Tempo, and then fetches every log line of each trace from Loki.
4. It opens this page with `#grafana`. The page replies `ready`, and `grafana.js` posts progress and then the data with `postMessage`. Both sides check the other's origin. Nothing goes through a server.

The page loads the log lines as if they were a Grafana CSV export, so List, Flow and Share work as usual, and opens the **Timeline** view:

- One card per request, in time order, with the time between cards.
- A bar that splits the request's time into Database, Outgoing calls, Queue (publish), Our code, Ingress and Waiting (no span running, such as a message sitting in a queue). Where steps overlap, the time goes to the most specific one, so the parts add up to the request's duration.
- The three slowest database or HTTP calls.
- A waterfall of spans, indented by parent. Three or more back-to-back database calls of the same shape are grouped. Hovering over a bar shows its SQL, URL, status, exceptions and the log lines written in that span (matched by `spanid`).
- Log lines appear as marks on their span's bar; red marks are exceptions and errors. Clicking one opens the entry, and **Back to timeline** returns.
- Lines with no trace id, such as the scheduler's merchant callbacks, are grouped by service and time (lines less than 5 s apart) into cards of their own.

Only span attributes that describe the call are kept: HTTP method, route, status and URL without its query string, server address, SQL text, messaging and exception attributes. Client addresses and user agents are dropped. Spans are kept in `sessionStorage` with the log lines, and shared links include them, masked like the log lines.

## First-time guide

A short guide opens the first time someone uses the formatter, the log viewer and the flow view. Each page is marked as seen with a flag in `localStorage`, so it shows once per browser. The **?** button in the header reopens it.

## Saved settings

The page saves theme, font size, indent, nested JSON expansion, the open tab, log sort order and the hide-common-fields option in the browser's local storage, and applies them on the next visit.

Pasted text and the open log file, with its filters and open entries, are kept in `sessionStorage`. They survive a refresh, but the browser deletes them when the tab closes. **Clear** in the log viewer forgets the file straight away.
