# Documentation captures

`lines/` contains automated browser captures of the bundle in the local preview. They are
not captures of a real Harness session. No hand captures or desktop-shell screenshot are
currently included here; generated atlas art and GIFs are in [`../README.md`](../README.md).

## Still useful

- The pet in a real Harness chat, with a bubble.
- The native pet over another application.

Capture a real instance with the ordinary OS screenshot tool; do not fabricate or compose
captures. For a manual shell run, start Harness and use:

```sh
npm run build:tauri:binary
./desktop/tauri/target/release/big-fat-fish-girl-shell \
  --url http://127.0.0.1:19490/big-fat-fish-girl/v1/desktop
```

The Harness server must be listening on port `19490` for this URL. The binary and Rust
shell are separate from the npm plugin; see [`../../../desktop/tauri/README.md`](../../../desktop/tauri/README.md).
