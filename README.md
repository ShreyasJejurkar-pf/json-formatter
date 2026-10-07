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
- Input that is not one JSON document, such as a raw log line, has every JSON object or array in it formatted.
- Numbers keep their original text, so `3026.00` and large IDs are not rounded.

Everything runs in the browser. The page loads no external scripts and sends nothing over the network.

## Source strip

When the JSON is a log entry, a strip above the output shows where it came from: `Application`, `Module`, `TransactionId`, `MerchantId`, service name, environment and version. Grafana's flattened column names such as `attributes_Module` work too.

## Log viewer

The **Log viewer** tab opens a Grafana logs panel CSV export, a JSON array of log entries, or newline-delimited JSON. Choose the file or drop it anywhere on the page.

- Entries are sorted by timestamp (the `tsNs` column when present). Each row shows the time and the gap since the previous entry, and gaps of 250 ms or more are highlighted.
- The summary lists the application, service, environment and version, plus transaction and merchant IDs, modules, traces, log types and severities. Clicking any of them filters the list.
- Opening an entry shows its message with the embedded JSON formatted, then its fields grouped as entry, attributes, resources and Grafana labels. Fields that are the same in every entry are hidden from each entry and listed once in the summary.
- **Prev** and **Next**, or the `k` and `j` keys, step through the entries one at a time.
- Each entry can be copied as JSON or opened in the formatter.
- **Flow** draws the entries as a sequence diagram between Merchant, PayFuture and Provider, using the `LogType` attribute (`API-MerchantRequestReceived`, `API-MerchantResponseSent`, `API-GatewayRequestSent`, `API-GatewayResponseReceived`, `API-GatewayWebhookReceived`, `API-MerchantCallbackSent`). Each response is paired with its request in the same trace to show the round-trip time and any status code. Log lines between calls collapse into an "internal steps" marker, and pauses of 2 s or more are marked. Clicking an arrow opens that entry.

## First-time guide

A short guide opens the first time someone uses the formatter, the log viewer and the flow view. Each page is marked as seen with a flag in `localStorage`, so it shows once per browser. The **?** button in the header reopens it.

## Saved settings

The page saves theme, font size, indent, nested JSON expansion, the open tab, log sort order and the hide-common-fields option in the browser's local storage, and applies them on the next visit.

Pasted text and the open log file, with its filters and open entries, are kept in `sessionStorage`. They survive a refresh, but the browser deletes them when the tab closes. **Clear** in the log viewer forgets the file straight away.
