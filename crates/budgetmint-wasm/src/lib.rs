//! budgetmint-core for every app, compiled to WebAssembly: its JSON host
//! (budgetmint_core::host::JsonHost) as a class JavaScript can hold. Only
//! calls live here; the coverage policy leaves the file out, and the host is
//! tested in core. scripts/build-wasm.mjs builds it into
//! packages/client/src/core/wasm.

use budgetmint_core::host::JsonHost;
use wasm_bindgen::prelude::*;

#[wasm_bindgen]
pub struct Core(JsonHost);

#[wasm_bindgen]
impl Core {
    /// `zone`: the device's IANA time zone (`Intl`).
    #[wasm_bindgen(constructor)]
    pub fn new(zone: &str) -> Core {
        Core(JsonHost::new(zone))
    }

    /// The user is in another zone now.
    #[wasm_bindgen(js_name = setZone)]
    pub fn set_zone(&mut self, zone: &str) {
        self.0.set_zone(zone)
    }

    /// Runs a command: its arguments as JSON, the time in milliseconds. The
    /// reply as JSON; an error throws the message.
    pub fn call(&mut self, name: &str, args: &str, now_ms: f64) -> Result<String, String> {
        self.0.call(name, args, now_ms)
    }
}
