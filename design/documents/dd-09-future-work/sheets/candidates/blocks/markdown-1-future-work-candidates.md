# Future Work (Candidates)

Candidates under consideration. Not commitments; each needs a design review before work starts.

| ID | Candidate | Today | Open points |
|---|---|---|---|
| FW-01 | Creating a project through MCP | `addProject` lists an existing project only; `project.json` has to be made by hand | Target folder, approval in the AI tool, entry point (`.dawn`) file |
| FW-02 | Documents in several languages | One language per document | One or more languages per document, switched in the application; MCP tools that keep every language in step (for example, report blocks whose translation is missing or older than the source); file format per language; which language is the source |
| FW-03 | Branch switching | Fetch, pull, push and publishing a branch are available; the current branch is shown only | Switching and creating branches in the application; open documents and unsaved changes when the branch changes |
| FW-04 | Projects inside a larger Git repository | Git features are off unless the project folder is the repository root | Git features for a project below the root; changes outside the project shown as such (marked, or grouped in their own tab) and hideable; MCP still limited to the project; what a commit includes |
