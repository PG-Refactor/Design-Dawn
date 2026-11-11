//! A three-way merge of `sheet.json` by Block, for a Git merge that touched the same Sheet on
//! both sides. Text merging would see two moved blocks as a conflict of nearby lines; here
//! each Block is compared by its id:
//! - changed (or added) on one side only: that side wins
//! - changed the same way on both: kept
//! - changed differently on both, or changed on one side and deleted on the other: a
//!   conflict, and nothing is merged (the user resolves the file)
//!
//! The Sheet's own fields (name, schema version) follow the same rule.

use std::collections::BTreeSet;

use serde_json::{Map, Value};

use crate::infrastructure::file_format::dto::{parse_dto, to_json_bytes, SheetDto};

const BLOCKS_KEY: &str = "blocks";
const BLOCK_ID_KEY: &str = "blockId";

/// Why a merge stopped: the field or Block ids both sides changed in different ways.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SheetConflicts {
    pub fields: Vec<String>,
    pub blocks: Vec<String>,
}

fn three_way<'a>(
    base: Option<&'a Value>,
    ours: Option<&'a Value>,
    theirs: Option<&'a Value>,
) -> Result<Option<&'a Value>, ()> {
    if ours == theirs {
        Ok(ours)
    } else if ours == base {
        Ok(theirs)
    } else if theirs == base {
        Ok(ours)
    } else {
        Err(())
    }
}

fn blocks_of(value: &Value) -> Vec<Value> {
    value
        .get(BLOCKS_KEY)
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default()
}

fn id_of(block: &Value) -> Option<String> {
    block
        .get(BLOCK_ID_KEY)
        .and_then(Value::as_str)
        .map(str::to_owned)
}

fn find<'a>(blocks: &'a [Value], id: &str) -> Option<&'a Value> {
    blocks
        .iter()
        .find(|block| id_of(block).as_deref() == Some(id))
}

/// The merged file (formatted like the app writes it), or what conflicts. `None` for base is
/// a Sheet both sides added.
pub fn merge_sheet(
    base: Option<&str>,
    ours: &str,
    theirs: &str,
) -> Result<Result<String, SheetConflicts>, String> {
    let parse = |text: &str| serde_json::from_str::<Value>(text).map_err(|error| error.to_string());
    let base = base
        .map(parse)
        .transpose()?
        .unwrap_or(Value::Object(Map::new()));
    let ours = parse(ours)?;
    let theirs = parse(theirs)?;
    let (Some(ours_map), Some(theirs_map)) = (ours.as_object(), theirs.as_object()) else {
        return Err("a sheet is not a JSON object".to_owned());
    };
    let mut conflicts = SheetConflicts {
        fields: Vec::new(),
        blocks: Vec::new(),
    };
    let mut merged = Map::new();
    let keys: BTreeSet<&String> = ours_map.keys().chain(theirs_map.keys()).collect();
    for key in keys {
        if key == BLOCKS_KEY {
            continue;
        }
        match three_way(base.get(key), ours_map.get(key), theirs_map.get(key)) {
            Ok(Some(value)) => {
                merged.insert(key.clone(), value.clone());
            }
            Ok(None) => {}
            Err(()) => conflicts.fields.push(key.clone()),
        }
    }
    let (base_blocks, our_blocks, their_blocks) =
        (blocks_of(&base), blocks_of(&ours), blocks_of(&theirs));
    // Our stacking order first, then Blocks only they have, in theirs.
    let mut order: Vec<String> = our_blocks.iter().filter_map(id_of).collect();
    for id in their_blocks.iter().filter_map(id_of) {
        if !order.contains(&id) {
            order.push(id);
        }
    }
    let mut blocks = Vec::new();
    for id in order {
        match three_way(
            find(&base_blocks, &id),
            find(&our_blocks, &id),
            find(&their_blocks, &id),
        ) {
            Ok(Some(block)) => blocks.push(block.clone()),
            Ok(None) => {}
            Err(()) => conflicts.blocks.push(id),
        }
    }
    if !conflicts.fields.is_empty() || !conflicts.blocks.is_empty() {
        return Ok(Err(conflicts));
    }
    merged.insert(BLOCKS_KEY.to_owned(), Value::Array(blocks));
    // Through the Sheet's own type: a result the app could not load is not offered.
    let sheet: SheetDto = parse_dto(Value::Object(merged)).map_err(|error| error.to_string())?;
    let bytes = to_json_bytes(&sheet).map_err(|error| error.to_string())?;
    String::from_utf8(bytes)
        .map(Ok)
        .map_err(|error| error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn block(id: &str, x: i64) -> String {
        format!(
            r#"{{"blockId":"{id}","blockType":"markdown","position":{{"x":{x},"y":0}},"size":{{"width":100,"height":50}},"contentPath":"sheets/s/blocks/markdown-{x}.md"}}"#
        )
    }

    fn sheet(blocks: &[String]) -> String {
        format!(
            r#"{{"schemaVersion":2,"sheetId":"01928f3a-7d8e-7f90-b123-456789abcdef","name":"S","blocks":[{}]}}"#,
            blocks.join(",")
        )
    }

    const A: &str = "01928f3a-0000-7000-8000-00000000000a";
    const B: &str = "01928f3a-0000-7000-8000-00000000000b";
    const C: &str = "01928f3a-0000-7000-8000-00000000000c";

    #[test]
    fn moves_of_different_blocks_and_an_addition_merge() {
        let base = sheet(&[block(A, 1), block(B, 2)]);
        let ours = sheet(&[block(A, 10), block(B, 2)]);
        let theirs = sheet(&[block(A, 1), block(B, 20), block(C, 3)]);
        let merged = merge_sheet(Some(&base), &ours, &theirs).unwrap().unwrap();
        let value: Value = serde_json::from_str(&merged).unwrap();
        let xs: Vec<i64> = value["blocks"]
            .as_array()
            .unwrap()
            .iter()
            .map(|block| block["position"]["x"].as_i64().unwrap())
            .collect();
        assert_eq!(xs, [10, 20, 3]);
    }

    #[test]
    fn the_same_block_changed_twice_is_a_conflict() {
        let base = sheet(&[block(A, 1)]);
        let ours = sheet(&[block(A, 10)]);
        let theirs = sheet(&[block(A, 20)]);
        assert_eq!(
            merge_sheet(Some(&base), &ours, &theirs).unwrap(),
            Err(SheetConflicts {
                fields: vec![],
                blocks: vec![A.to_owned()]
            })
        );
    }

    #[test]
    fn a_deletion_merges_unless_the_other_side_changed_the_block() {
        let base = sheet(&[block(A, 1), block(B, 2)]);
        let ours = sheet(&[block(B, 2)]);
        let theirs = sheet(&[block(A, 1), block(B, 2)]);
        let merged = merge_sheet(Some(&base), &ours, &theirs).unwrap().unwrap();
        assert!(!merged.contains(A));
        let changed = sheet(&[block(A, 5), block(B, 2)]);
        assert!(merge_sheet(Some(&base), &ours, &changed).unwrap().is_err());
    }
}
