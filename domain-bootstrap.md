# Domain Bootstrap

Use your domain as a stable, no-cost discovery front door for the arbiter.

## Recommended file

Host this at:

`https://tysonross.com/.well-known/hearthwick-bootstrap.json`

Example contents:

```json
{
  "arbiterUrl": "https://arbiter.tysonross.com"
}
```

## Client behavior

The client now checks for this bootstrap JSON at startup when `bootstrap=tysonross.com` is set or when `hearthwick_bootstrap_domain` is present in `localStorage`.

The arbiter URL can still be overridden manually with:

- `?arbiter=https://...`
- `?arbiter=self`
- `localStorage.hearthwick_arbiter_url`

## Practical setup

1. Keep the arbiter running on the Pi at `127.0.0.1:3001`.
2. Expose it however you prefer later, but publish the resulting URL in the bootstrap JSON.
3. Point the game at the bootstrap domain instead of hardcoding an arbiter URL.

## Notes

- This is bootstrap metadata, not live signaling.
- It is safe to keep it tiny and cacheable.
- If the game is also served from `tysonross.com`, this is same-origin and CORS is not needed.
- If the game is hosted somewhere else, GH Pages will not let you add custom CORS headers, so the fetch may be blocked unless you keep the game on the same origin or move the bootstrap file behind a server you control.
