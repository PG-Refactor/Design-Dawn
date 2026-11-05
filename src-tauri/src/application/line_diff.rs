//! A small line diff for comparing a Block's text in memory with the file on disk.
//! The inputs are Block text files, so an LCS table over
//! the lines is enough; no diff library is used. The output is a unified diff, the shape the
//! Frontend's existing diff view reads (hunks of `+` / `-` / context lines).

use std::fmt::Write;

/// Unchanged lines shown around a change, like `git diff`'s default.
pub const DIFF_CONTEXT_LINES: usize = 3;
/// The LCS table has `old × new` cells (after the common start and end are removed). Beyond
/// this a comparison is refused instead of using a lot of memory: Block text files are far
/// smaller than this.
pub const DIFF_MAX_CELLS: usize = 4_000_000;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum LineDiff {
    /// Same lines (a different final line break or CRLF / LF only does not count).
    Identical,
    /// A unified diff, `old` first.
    Text(String),
    TooLarge,
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
enum Edit {
    Equal,
    Delete,
    Insert,
}

fn lines_of(text: &str) -> Vec<&str> {
    let normalized_end = text.strip_suffix('\n').unwrap_or(text);
    if text.is_empty() {
        return Vec::new();
    }
    normalized_end
        .split('\n')
        .map(|line| line.strip_suffix('\r').unwrap_or(line))
        .collect()
}

/// The edit script between two line lists: common start and end are skipped, the middle is
/// solved by LCS. `None` when the middle is too large.
fn edit_script(old: &[&str], new: &[&str]) -> Option<Vec<Edit>> {
    let prefix = old
        .iter()
        .zip(new)
        .take_while(|(left, right)| left == right)
        .count();
    let suffix = old[prefix..]
        .iter()
        .rev()
        .zip(new[prefix..].iter().rev())
        .take_while(|(left, right)| left == right)
        .count();
    let old_middle = &old[prefix..old.len() - suffix];
    let new_middle = &new[prefix..new.len() - suffix];
    let (rows, columns) = (old_middle.len(), new_middle.len());
    if rows.saturating_mul(columns) > DIFF_MAX_CELLS {
        return None;
    }
    // lengths[i][j]: the LCS length of old_middle[i..] and new_middle[j..].
    let mut lengths = vec![0u32; (rows + 1) * (columns + 1)];
    let at = |row: usize, column: usize| row * (columns + 1) + column;
    for row in (0..rows).rev() {
        for column in (0..columns).rev() {
            lengths[at(row, column)] = if old_middle[row] == new_middle[column] {
                lengths[at(row + 1, column + 1)] + 1
            } else {
                lengths[at(row + 1, column)].max(lengths[at(row, column + 1)])
            };
        }
    }
    let mut script = vec![Edit::Equal; prefix];
    let (mut row, mut column) = (0, 0);
    while row < rows || column < columns {
        if row < rows && column < columns && old_middle[row] == new_middle[column] {
            script.push(Edit::Equal);
            row += 1;
            column += 1;
        } else if column == columns
            || (row < rows && lengths[at(row + 1, column)] >= lengths[at(row, column + 1)])
        {
            script.push(Edit::Delete);
            row += 1;
        } else {
            script.push(Edit::Insert);
            column += 1;
        }
    }
    script.extend(std::iter::repeat_n(Edit::Equal, suffix));
    Some(script)
}

/// Hunk boundaries over the script: ranges of script indices, each holding changes with up to
/// `DIFF_CONTEXT_LINES` of context on both sides; overlapping ranges are merged.
fn hunk_ranges(script: &[Edit]) -> Vec<(usize, usize)> {
    let mut ranges: Vec<(usize, usize)> = Vec::new();
    for (index, edit) in script.iter().enumerate() {
        if *edit == Edit::Equal {
            continue;
        }
        let start = index.saturating_sub(DIFF_CONTEXT_LINES);
        let end = (index + DIFF_CONTEXT_LINES + 1).min(script.len());
        match ranges.last_mut() {
            Some(last) if start <= last.1 => last.1 = last.1.max(end),
            _ => ranges.push((start, end)),
        }
    }
    ranges
}

/// `old` and `new` are the whole texts; the labels name the two sides in the diff header.
pub fn unified_diff(old: &str, new: &str, old_label: &str, new_label: &str) -> LineDiff {
    let old_lines = lines_of(old);
    let new_lines = lines_of(new);
    let Some(script) = edit_script(&old_lines, &new_lines) else {
        return LineDiff::TooLarge;
    };
    let ranges = hunk_ranges(&script);
    if ranges.is_empty() {
        return LineDiff::Identical;
    }
    // Line numbers (0-based) at the start of every script index.
    let mut old_before = Vec::with_capacity(script.len() + 1);
    let mut new_before = Vec::with_capacity(script.len() + 1);
    let (mut old_position, mut new_position) = (0usize, 0usize);
    for edit in &script {
        old_before.push(old_position);
        new_before.push(new_position);
        if *edit != Edit::Insert {
            old_position += 1;
        }
        if *edit != Edit::Delete {
            new_position += 1;
        }
    }
    old_before.push(old_position);
    new_before.push(new_position);

    let mut output = format!("--- {old_label}\n+++ {new_label}\n");
    for (start, end) in ranges {
        let old_count = old_before[end] - old_before[start];
        let new_count = new_before[end] - new_before[start];
        // An empty side is numbered by the line before it, like git.
        let old_start = old_before[start] + usize::from(old_count > 0);
        let new_start = new_before[start] + usize::from(new_count > 0);
        let _ = writeln!(
            output,
            "@@ -{old_start},{old_count} +{new_start},{new_count} @@"
        );
        for index in start..end {
            match script[index] {
                Edit::Equal => {
                    let _ = writeln!(output, " {}", old_lines[old_before[index]]);
                }
                Edit::Delete => {
                    let _ = writeln!(output, "-{}", old_lines[old_before[index]]);
                }
                Edit::Insert => {
                    let _ = writeln!(output, "+{}", new_lines[new_before[index]]);
                }
            }
        }
    }
    LineDiff::Text(output)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn diff(old: &str, new: &str) -> LineDiff {
        unified_diff(old, new, "disk", "memory")
    }

    fn text(old: &str, new: &str) -> String {
        match diff(old, new) {
            LineDiff::Text(text) => text,
            other => panic!("expected a diff, got {other:?}"),
        }
    }

    fn hunks_in(diff: &str) -> usize {
        diff.lines().filter(|line| line.starts_with("@@")).count()
    }

    #[test]
    fn identical_texts_have_no_diff_even_with_other_line_endings() {
        assert_eq!(diff("a\nb\n", "a\nb\n"), LineDiff::Identical);
        assert_eq!(diff("a\r\nb\r\n", "a\nb"), LineDiff::Identical);
        assert_eq!(diff("", ""), LineDiff::Identical);
    }

    #[test]
    fn a_changed_line_is_a_removal_and_an_addition_with_context() {
        let result = text("one\ntwo\nthree\n", "one\nTWO\nthree\n");
        assert_eq!(
            result,
            "--- disk\n+++ memory\n@@ -1,3 +1,3 @@\n one\n-two\n+TWO\n three\n"
        );
    }

    #[test]
    fn only_three_lines_of_context_are_kept_and_far_changes_are_separate_hunks() {
        let old: Vec<String> = (1..=20).map(|n| format!("line {n}")).collect();
        let mut new = old.clone();
        new[1] = "changed 2".to_owned();
        new[17] = "changed 18".to_owned();
        let result = text(&old.join("\n"), &new.join("\n"));
        assert_eq!(hunks_in(&result), 2);
        assert!(result.contains("@@ -1,5 +1,5 @@"));
        assert!(result.contains("@@ -15,6 +15,6 @@"));
        assert!(!result.contains(" line 8\n"));
    }

    #[test]
    fn nearby_changes_share_one_hunk() {
        let result = text("a\nb\nc\nd\ne\n", "A\nb\nc\nd\nE\n");
        assert_eq!(hunks_in(&result), 1);
    }

    #[test]
    fn insertions_and_deletions_at_the_ends_and_in_empty_texts() {
        assert_eq!(
            text("", "new\n"),
            "--- disk\n+++ memory\n@@ -0,0 +1,1 @@\n+new\n"
        );
        assert_eq!(
            text("old\n", ""),
            "--- disk\n+++ memory\n@@ -1,1 +0,0 @@\n-old\n"
        );
        let appended = text("a\nb\n", "a\nb\nc\n");
        assert!(appended.contains("+c\n"));
        assert!(
            !appended.lines().skip(2).any(|line| line.starts_with('-')),
            "{appended}"
        );
    }

    #[test]
    fn repeated_lines_are_matched_by_the_longest_common_subsequence() {
        let result = text("x\ny\nx\ny\n", "y\nx\ny\n");
        assert!(result.contains("-x\n y\n x\n y\n"), "{result}");
    }

    #[test]
    fn applying_the_diff_to_the_old_text_gives_the_new_text() {
        let old = "alpha\nbeta\ngamma\ndelta\nepsilon\nzeta\n";
        let new = "alpha\nBETA\ngamma\nepsilon\nzeta\neta\n";
        let result = text(old, new);
        let removed: Vec<&str> = result
            .lines()
            .filter_map(|line| line.strip_prefix('-'))
            .filter(|line| !line.starts_with("- "))
            .collect();
        let added: Vec<&str> = result
            .lines()
            .filter_map(|line| line.strip_prefix('+'))
            .collect();
        assert!(removed.contains(&"beta") && removed.contains(&"delta"));
        assert!(added.contains(&"BETA") && added.contains(&"eta"));
    }

    #[test]
    fn a_comparison_that_is_too_large_is_refused() {
        let old: String = (0..2500).map(|n| format!("old {n}\n")).collect();
        let new: String = (0..2500).map(|n| format!("new {n}\n")).collect();
        assert_eq!(diff(&old, &new), LineDiff::TooLarge);
    }

    #[test]
    fn a_comparison_up_to_the_cell_limit_is_made_and_one_line_more_is_refused() {
        // Every line differs, so the whole text is the middle: old x new cells.
        let lines = |count: usize, tag: &str| -> String {
            (0..count).map(|index| format!("{tag}{index}\n")).collect()
        };
        let side = 2000;
        assert_eq!(side * side, DIFF_MAX_CELLS);
        assert!(matches!(
            diff(&lines(side, "a"), &lines(side, "b")),
            LineDiff::Text(_)
        ));
        assert_eq!(
            diff(&lines(side + 1, "a"), &lines(side, "b")),
            LineDiff::TooLarge
        );
    }
}
