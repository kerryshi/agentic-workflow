# Actual Behavior

spawn() threw synchronously inside the Promise executor with no try/catch; rejection escaped runProcess through both drivers; Engine.isAvailable had no guard so the CLI died pre-createRun