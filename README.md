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
