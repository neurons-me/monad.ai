//monad.ai/crate/src/state.rs
use std::collections::HashMap;
use std::sync::Mutex;
use this_me::Me;

/// Estado global compartido entre los endpoints
#[derive(Default)]
pub struct AppState {
    pub mes: Mutex<HashMap<String, Me>>, // alias -> Me instance
}