# Local preview

Run the pet and its controls in a mock chat page without starting DeepSeek Harness:

```sh
node preview/server.mjs          # http://127.0.0.1:41739
node preview/server.mjs --port 4200
```

Use the controls to set states and try tool phases, inspect animation timing and bubbles, or
check an animation before connecting it to behavior. The preview serves the same state,
SSE events, manifest, atlas, and whitelisted sheet routes as the plugin; its
`/big-fat-fish-girl/v1/preview/state` control route exists only in this preview server.

The surrounding chat is a mock, not a Harness integration. This development tool is not
loaded by the plugin. It binds to loopback, reads no files outside the repository, and
stores nothing.
