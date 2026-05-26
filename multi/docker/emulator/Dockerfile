FROM debian:bookworm-slim AS builder

RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    ca-certificates \
    cmake \
    git \
    python3 \
    libsdl2-dev \
    liblua5.4-dev \
    libpng-dev \
    zlib1g-dev \
    libzip-dev \
    zipcmp \
    zipmerge \
    ziptool \
    libsqlite3-dev \
    libelf-dev \
    && rm -rf /var/lib/apt/lists/*

# Build mGBA from source with Lua scripting enabled
RUN git clone --depth 1 https://github.com/mgba-emu/mgba.git /mgba

RUN python3 - <<'PY'
from pathlib import Path

path = Path('/mgba/src/platform/sdl/main.c')
text = path.read_text()
text = text.replace('#include <mgba/core/scripting.h>\n', '#include <mgba/core/scripting.h>\n#include <mgba/script/base.h>\n#include <mgba/script/console.h>\n#include <mgba/script/context.h>\n')
text = text.replace('#include <signal.h>\n', '#include <signal.h>\n#include <string.h>\n')
text = text.replace('static struct VFile* _state = NULL;\n', '''static struct VFile* _state = NULL;

#ifdef ENABLE_SCRIPTING
struct mScriptOpts {
\tconst char* script;
};

static const char* _scriptPath = NULL;

static const struct mOption _scriptLongOpts[] = {
\t{ "script", true, '\\0' },
\t{ 0, 0, 0 }
};

static bool _parseLongScriptArg(struct mSubParser* parser, const char* option, const char* arg) {
\tstruct mScriptOpts* opts = parser->opts;
\tif (strcmp(option, "script") == 0) {
\t\topts->script = arg;
\t\treturn true;
\t}
\treturn false;
}

static void mSubParserScriptInit(struct mSubParser* parser, struct mScriptOpts* opts) {
\tparser->usage = "Scripting options:\\n  --script FILE              Load Lua script";
\tparser->opts = opts;
\tparser->parse = NULL;
\tparser->parseLong = _parseLongScriptArg;
\tparser->apply = NULL;
\tparser->extraOptions = NULL;
\tparser->longOptions = _scriptLongOpts;
\topts->script = NULL;
}
#endif
''')
text = text.replace('''\tstruct mSubParser subparser;

\tmSubParserGraphicsInit(&subparser, &graphicsOpts);
\tbool parsed = mArgumentsParse(&args, argc, argv, &subparser, 1);
''', '''\tstruct mSubParser subparsers[2];
\tint nSubparsers = 1;
#ifdef ENABLE_SCRIPTING
\tstruct mScriptOpts scriptOpts;
#endif

\tmSubParserGraphicsInit(&subparsers[0], &graphicsOpts);
#ifdef ENABLE_SCRIPTING
\tmSubParserScriptInit(&subparsers[1], &scriptOpts);
\tnSubparsers = 2;
#endif
\tbool parsed = mArgumentsParse(&args, argc, argv, subparsers, nSubparsers);
''')
text = text.replace('usage(argv[0], NULL, NULL, &subparser, 1);', 'usage(argv[0], NULL, NULL, subparsers, nSubparsers);')
text = text.replace('mArgumentsApply(&args, &subparser, 1, &renderer.core->config);', 'mArgumentsApply(&args, subparsers, nSubparsers, &renderer.core->config);')
text = text.replace('''\tif (args.showVersion) {
\t\tversion(argv[0]);
\t\tmArgumentsDeinit(&args);
\t\treturn 0;
\t}
''', '''\tif (args.showVersion) {
\t\tversion(argv[0]);
\t\tmArgumentsDeinit(&args);
\t\treturn 0;
\t}
#ifdef ENABLE_SCRIPTING
\t_scriptPath = scriptOpts.script;
#endif
''')
text = text.replace('''\tmCoreAutoloadSave(renderer->core);
\tmArgumentsApplyFileLoads(args, renderer->core);
#ifdef ENABLE_SCRIPTING
\tstruct mScriptBridge* bridge = mScriptBridgeCreate();
''', '''\tmCoreAutoloadSave(renderer->core);
\tmArgumentsApplyFileLoads(args, renderer->core);
#ifdef ENABLE_SCRIPTING
\tstruct mScriptContext scriptContext;
\tmScriptContextInit(&scriptContext);
\tmScriptContextAttachStdlib(&scriptContext);
\tmScriptContextAttachSocket(&scriptContext);
\tmScriptContextRegisterEngines(&scriptContext);
\tmScriptContextAttachLogger(&scriptContext, &_logger.d);
\tthread.scriptContext = &scriptContext;

\tstruct mScriptBridge* bridge = mScriptBridgeCreate();
''')
text = text.replace('''\tbool didFail = !mCoreThreadStart(&thread);

\tif (!didFail) {
''', '''\tbool didFail = !mCoreThreadStart(&thread);

#ifdef ENABLE_SCRIPTING
\tif (!didFail && _scriptPath) {
\t\tmCoreThreadPause(&thread);
\t\tif (!mScriptContextLoadFile(&scriptContext, _scriptPath)) {
\t\t\tprintf("Could not load script: %s\\n", _scriptPath);
\t\t}
\t\tmCoreThreadUnpause(&thread);
\t}
#endif

\tif (!didFail) {
''')
text = text.replace('''#ifdef ENABLE_SCRIPTING
\tmScriptBridgeDestroy(bridge);
#endif
''', '''#ifdef ENABLE_SCRIPTING
\tmScriptBridgeDestroy(bridge);
\tmScriptContextDeinit(&scriptContext);
#endif
''')
path.write_text(text)
PY

RUN grep -q 'parseLongScriptArg' /mgba/src/platform/sdl/main.c || \
    (echo "FATAL: Source patch failed — mGBA source has changed" && exit 1)

WORKDIR /mgba/build
RUN cmake .. \
    -DCMAKE_BUILD_TYPE=Release \
    -DBUILD_SDL=ON \
    -DBUILD_QT=OFF \
    -DBUILD_LIBRETRO=OFF \
    -DUSE_FFMPEG=OFF \
    -DUSE_MINIZIP=OFF \
    -DUSE_DISCORD_RPC=OFF \
    -DUSE_EDITLINE=OFF \
    -DUSE_ELF=OFF \
    -DUSE_SQLITE3=OFF \
    -DUSE_LUA=ON \
    && make -j$(nproc) mgba-sdl \
    && make install DESTDIR=/install

FROM debian:bookworm-slim

# Runtime dependencies only
RUN apt-get update && apt-get install -y --no-install-recommends \
    xvfb \
    x11-utils \
    tini \
    procps \
    libsdl2-2.0-0 \
    libgl1 \
    liblua5.4-0 \
    libpng16-16 \
    zlib1g \
    libzip4 \
    && rm -rf /var/lib/apt/lists/*

COPY --from=builder /install/usr/local/bin/mgba /usr/local/bin/mgba-sdl
COPY --from=builder /install/usr/local/lib/libmgba.so* /usr/local/lib/
COPY scripts/mGBASocketServer.lua /app/mGBASocketServer.lua
COPY entrypoint.sh /entrypoint.sh
RUN ldconfig && chmod +x /entrypoint.sh

EXPOSE 8888

ENTRYPOINT ["/usr/bin/tini", "--", "/entrypoint.sh"]
