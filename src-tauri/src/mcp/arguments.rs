//! Reads the `arguments` object of a tool call. Unknown keys are refused so a misspelled
//! optional argument is reported instead of silently ignored.

use serde_json::{Map, Value};

use super::tool_definitions::ToolDefinition;
use super::tool_error::ToolError;

pub struct Arguments<'a> {
    values: &'a Map<String, Value>,
}

fn reject_unknown_keys(values: &Map<String, Value>, allowed: &[&str]) -> Result<(), ToolError> {
    match values.keys().find(|key| !allowed.contains(&key.as_str())) {
        Some(key) => Err(ToolError::invalid_arguments(format!(
            "unknown argument: {key}"
        ))),
        None => Ok(()),
    }
}

impl<'a> Arguments<'a> {
    pub fn new(
        values: &'a Map<String, Value>,
        definition: &ToolDefinition,
    ) -> Result<Self, ToolError> {
        let allowed: Vec<&str> = definition.property_names().collect();
        reject_unknown_keys(values, &allowed)?;
        Ok(Self { values })
    }

    pub fn string(&self, key: &str) -> Result<&'a str, ToolError> {
        self.optional_string(key)?
            .ok_or_else(|| ToolError::invalid_arguments(format!("{key} is required")))
    }

    pub fn optional_string(&self, key: &str) -> Result<Option<&'a str>, ToolError> {
        match self.values.get(key) {
            None | Some(Value::Null) => Ok(None),
            Some(Value::String(text)) => Ok(Some(text.as_str())),
            Some(_) => Err(ToolError::invalid_arguments(format!(
                "{key} must be a string"
            ))),
        }
    }

    /// An object of exactly two integer fields, such as `{ "x": 0, "y": 0 }`.
    pub fn optional_pair(
        &self,
        key: &str,
        first: &str,
        second: &str,
    ) -> Result<Option<(i64, i64)>, ToolError> {
        let object = match self.values.get(key) {
            None | Some(Value::Null) => return Ok(None),
            Some(Value::Object(object)) => object,
            Some(_) => {
                return Err(ToolError::invalid_arguments(format!(
                    "{key} must be an object"
                )))
            }
        };
        reject_unknown_keys(object, &[first, second])?;
        let read = |field: &str| {
            object.get(field).and_then(Value::as_i64).ok_or_else(|| {
                ToolError::invalid_arguments(format!("{key}.{field} must be an integer"))
            })
        };
        Ok(Some((read(first)?, read(second)?)))
    }

    pub fn pair(&self, key: &str, first: &str, second: &str) -> Result<(i64, i64), ToolError> {
        self.optional_pair(key, first, second)?
            .ok_or_else(|| ToolError::invalid_arguments(format!("{key} is required")))
    }
}
