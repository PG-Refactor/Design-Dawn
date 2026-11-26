# Future Work (Candidates)

Candidates under consideration. Not commitments; each needs a design review before work starts.

| ID | Candidate | Today | Open points |
|---|---|---|---|
| FW-01 | Creating a project through MCP | `addProject` lists an existing project only; `project.json` has to be made by hand | Target folder, approval in the AI tool, entry point (`.dawn`) file |
| FW-02 | Documents in several languages | One language per document | One or more languages per document, switched in the application; MCP tools that keep every language in step (for example, report blocks whose translation is missing or older than the source); file format per language; which language is the source |
| FW-03 | Branch switching | Fetch, pull, push and publishing a branch are available; the current branch is shown only | Switching and creating branches in the application; open documents and unsaved changes when the branch changes |
| FW-04 | Projects inside a larger Git repository | Git features are off unless the project folder is the repository root | Git features for a project below the root; changes outside the project shown as such (marked, or grouped in their own tab) and hideable; MCP still limited to the project; what a commit includes |
| FW-05 | Creating a project inside a Git repository | No Git check when a project is created; the application cannot create a repository (`git init`) | Tell the user that the chosen folder is inside a repository and let them choose: manage the project with that repository (needs FW-04), or give the project a repository of its own (Git allows one inside another; the outer one then sees it as an embedded repository). If the choice is not offered, show the message and use the outer repository |
| FW-06 | Customisable keyboard shortcuts | Keys are fixed, defined per feature (canvas, tree, find, print, save, undo / redo) | A settings screen to change and reset keys; conflicts between commands; keys the operating system or the web view keeps; stored in the application settings, not in projects |
