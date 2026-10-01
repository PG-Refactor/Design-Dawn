use std::collections::HashSet;
use std::fmt;
use std::hash::Hash;

use uuid::Uuid;

use super::constants::{
    ENTITY_ID_HYPHEN_POSITIONS, ENTITY_ID_LENGTH, ENTITY_ID_VARIANT_CHARACTERS,
    ENTITY_ID_VARIANT_POSITION, ENTITY_ID_VERSION_CHARACTER, ENTITY_ID_VERSION_POSITION,
};
use super::error::{DomainError, DomainErrorKind};

fn is_canonical_entity_id(value: &str) -> bool {
    let bytes = value.as_bytes();
    if bytes.len() != ENTITY_ID_LENGTH {
        return false;
    }
    let hyphens_and_hex_are_valid = bytes.iter().enumerate().all(|(position, byte)| {
        if ENTITY_ID_HYPHEN_POSITIONS.contains(&position) {
            *byte == b'-'
        } else {
            matches!(byte, b'0'..=b'9' | b'a'..=b'f')
        }
    });
    hyphens_and_hex_are_valid
        && bytes[ENTITY_ID_VERSION_POSITION] == ENTITY_ID_VERSION_CHARACTER
        && ENTITY_ID_VARIANT_CHARACTERS.contains(&bytes[ENTITY_ID_VARIANT_POSITION])
}

// `Uuid::parse_str` alone would accept uppercase, braces, urn and simple forms,
// so the canonical check must come first; it never normalizes.
fn parse_canonical_uuid(value: &str) -> Result<Uuid, DomainError> {
    let invalid = || {
        DomainError::new(
            DomainErrorKind::InvalidEntityId,
            format!("not a canonical UUIDv7: {value:?}"),
        )
    };
    if !is_canonical_entity_id(value) {
        return Err(invalid());
    }
    Uuid::parse_str(value).map_err(|_| invalid())
}

macro_rules! define_entity_id {
    ($name:ident) => {
        #[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord)]
        pub struct $name(Uuid);

        impl $name {
            pub fn parse(value: &str) -> Result<Self, DomainError> {
                parse_canonical_uuid(value).map(Self)
            }

            pub fn as_uuid(&self) -> &Uuid {
                &self.0
            }
        }

        impl fmt::Display for $name {
            fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
                write!(formatter, "{}", self.0.hyphenated())
            }
        }
    };
}

define_entity_id!(ProjectId);
define_entity_id!(DocumentId);
define_entity_id!(SheetId);
define_entity_id!(BlockId);

/// Parses every element first, then checks uniqueness, so element errors win over `duplicateId`.
pub fn parse_unique_ids<Id>(
    values: &[String],
    parse: fn(&str) -> Result<Id, DomainError>,
) -> Result<Vec<Id>, DomainError>
where
    Id: Eq + Hash + fmt::Display,
{
    let ids = values
        .iter()
        .map(|value| parse(value))
        .collect::<Result<Vec<Id>, DomainError>>()?;
    ensure_unique(&ids)?;
    Ok(ids)
}

pub fn ensure_unique<Id>(ids: &[Id]) -> Result<(), DomainError>
where
    Id: Eq + Hash + fmt::Display,
{
    let mut seen = HashSet::new();
    for id in ids {
        if !seen.insert(id) {
            return Err(DomainError::new(
                DomainErrorKind::DuplicateId,
                format!("duplicate id: {id}"),
            ));
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    const VALID: &str = "01928f3a-5b6c-7d8e-9f01-23456789abcd";

    #[test]
    fn display_round_trips_the_canonical_string() {
        assert_eq!(BlockId::parse(VALID).unwrap().to_string(), VALID);
    }

    #[test]
    fn rejects_forms_that_uuid_parse_str_would_accept() {
        for value in [
            "01928F3A-5B6C-7D8E-9F01-23456789ABCD",
            "{01928f3a-5b6c-7d8e-9f01-23456789abcd}",
            "01928f3a5b6c7d8e9f0123456789abcd",
        ] {
            assert!(ProjectId::parse(value).is_err(), "{value}");
        }
    }

    #[test]
    fn rejects_non_ascii_input_without_panicking() {
        assert!(SheetId::parse("０1928f3a-5b6c-7d8e-9f01-23456789abcd").is_err());
    }
}
