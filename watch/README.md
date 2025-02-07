# @frontside/watch

Watch is a very simple tool that does one thing: run a command, and every time
source files change in a directory, shutdown the current invocation _gracefully_
and restart it.

```
deno -A jsr:@frontside/watch --command "npm start"
```

## Graceful Shutdown

Watch will send SIGINT and SIGTERM to your command, and then wait until its
`stdout` stream is closed, indicating that it has no further output. It will not
attempt to start your command again until that has happened. This is important,
because your process might be holding onto any number of resources that have to
be safely released before exiting.

## Git aware

If you are running this command inside a git repository, it will only perform
restarts on files that are under source control, or could be candidates for
source control (not ignored).
