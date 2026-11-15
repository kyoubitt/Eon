# Security

Eon runs commands and edits files on your computer on behalf of a model it does not control. The rules that keep that safe (plan gate, permission prompts, secret redaction, protected paths, no home-folder repositories) are enforced in code.

**Report a vulnerability** privately through GitHub: Security tab, then "Report a vulnerability" on this repository. Please do not open a public issue for something exploitable. Include what you ran, what you expected and what happened.

**Things to know**
- Eon drives a website with your own login. It stores that login only in the browser profile at `~/.eon/chrome`, never in its own files.
- Text from a web page or a model is treated as untrusted data: tool results are labelled, secrets are redacted before anything is stored or exported, and MCP servers, hooks from a downloaded project and new hosts need your approval.
- Automating a chat site may be against its terms. See the README's questions section.
