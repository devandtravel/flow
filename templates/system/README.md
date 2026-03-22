# FLOW System Contour

This template installs FLOW as a daemon that manages one or more scoped targets.

- each task must execute inside a configured target workspace
- the daemon keeps the REST API and worker loop separate
- schedules can enqueue recurring goals
- `shell.exec` stays disabled until explicitly enabled in both capabilities and policy
