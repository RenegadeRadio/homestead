"use client";

import { useEffect, useState } from "react";
import { FileText, Folder, TerminalSquare } from "lucide-react";

import { LiveBrowser } from "@/components/crew/live-browser";

import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { loadComputer, loadFile } from "@/lib/client";
import type { FileNode, Store } from "@/lib/types";

export function ComputerPane({
  store,
  tree,
  selected,
  onSelect,
  compact,
  preferTab,
}: {
  store: Store;
  tree: FileNode[];
  selected: string | null;
  onSelect: (path: string) => void;
  compact?: boolean;
  preferTab?: "files" | "terminal" | "browser" | "activity";
}) {
  const [tab, setTab] = useState(preferTab ?? (compact ? "browser" : "files"));
  const [prevPreferTab, setPrevPreferTab] = useState(preferTab);
  const [content, setContent] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [live, setLive] = useState<{
    tree: FileNode[];
    logs: Store["computerLogs"];
    terminal: Store["terminalSessions"];
    browse: Store["browseSnapshots"];
  } | null>(null);

  const liveTree = live?.tree ?? tree;
  const logs = live?.logs ?? store.computerLogs;
  const terminal = live?.terminal ?? store.terminalSessions;

  useEffect(() => {
    if (!selected) return;
    let cancelled = false;
    loadFile(selected)
      .then((data) => {
        if (!cancelled) {
          setContent(data.content);
          setError(null);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setContent("");
          setError(err instanceof Error ? err.message : "Cannot preview this file.");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [selected]);

  if (preferTab !== prevPreferTab) {
    setPrevPreferTab(preferTab);
    if (preferTab) {
      setTab(preferTab);
    }
  }

  async function refresh() {
    const data = await loadComputer();
    setLive({
      tree: data.tree,
      logs: data.logs,
      terminal: data.terminal,
      browse: data.browse,
    });
  }

  return (
    <div className="flex h-full flex-col bg-card">
      <div className="flex items-center gap-2 border-b px-3 py-3">
        <div>
          <div className="text-sm font-semibold">Shared computer</div>
          <div className="text-[11px] text-muted-foreground">Every Bot works here. Files, terminal, browser.</div>
        </div>
        <Button size="sm" variant="ghost" className="ml-auto" onClick={() => void refresh()}>
          Refresh
        </Button>
      </div>
      <Tabs value={tab} onValueChange={setTab} className="flex min-h-0 flex-1 flex-col">
        <TabsList className="mx-3 mt-2 w-auto justify-start">
          <TabsTrigger value="files">Files</TabsTrigger>
          <TabsTrigger value="terminal">Terminal</TabsTrigger>
          <TabsTrigger value="browser">Browser</TabsTrigger>
          <TabsTrigger value="activity">Activity</TabsTrigger>
        </TabsList>
        <TabsContent value="files" className="min-h-0 flex-1">
          <div className={`grid min-h-0 flex-1 ${compact ? "grid-rows-2" : "grid-cols-1 md:grid-cols-[220px_1fr]"} h-full`}>
            <ScrollArea className="border-b md:border-r md:border-b-0">
              <div className="p-2">
                <FileTree nodes={liveTree} selected={selected} onSelect={onSelect} />
              </div>
            </ScrollArea>
            <ScrollArea className="min-h-0">
              <div className="p-3">
                {selected ? (
                  <>
                    <div className="mb-2 font-mono text-xs text-muted-foreground">{selected}</div>
                    {error ? (
                      <p className="text-sm text-muted-foreground">{error}</p>
                    ) : (
                      <pre className="whitespace-pre-wrap font-mono text-xs leading-relaxed">{content}</pre>
                    )}
                  </>
                ) : (
                  <p className="text-sm text-muted-foreground">Pick a file. Deliverables live on disk so handoffs do not depend on chat.</p>
                )}
              </div>
            </ScrollArea>
          </div>
        </TabsContent>
        <TabsContent value="terminal" className="min-h-0 flex-1">
          <ScrollArea className="h-full">
            <div className="space-y-3 p-3 font-mono text-xs">
              {terminal.length === 0 ? (
                <Empty icon={<TerminalSquare className="size-4" />} text="No commands yet. Ask Forge to run something — approval still applies." />
              ) : (
                terminal.map((line) => (
                  <div key={line.id} className="rounded-lg bg-black/40 p-3">
                    <div className="text-primary">$ {line.command}</div>
                    <pre className="mt-2 whitespace-pre-wrap text-muted-foreground">{line.output || "(no output)"}</pre>
                    <div className="mt-1 text-[10px] text-muted-foreground">exit {line.exitCode}</div>
                  </div>
                ))
              )}
            </div>
          </ScrollArea>
        </TabsContent>
        <TabsContent value="browser" className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <LiveBrowser />
        </TabsContent>
        <TabsContent value="activity" className="min-h-0 flex-1">
          <ScrollArea className="h-full">
            <div className="space-y-2 p-3">
              {logs.length === 0 ? (
                <Empty icon={<FileText className="size-4" />} text="Tool activity from every Bot lands in this log." />
              ) : (
                logs.map((log) => (
                  <div key={log.id} className="rounded-lg border px-3 py-2 text-xs">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium">{log.summary}</span>
                      <span className="text-[10px] text-muted-foreground uppercase">{log.kind}</span>
                    </div>
                    {log.detail ? <pre className="mt-1 max-h-24 overflow-auto whitespace-pre-wrap text-muted-foreground">{log.detail}</pre> : null}
                  </div>
                ))
              )}
            </div>
          </ScrollArea>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function Empty({ icon, text }: { icon: React.ReactNode; text: string }) {
  return (
    <div className="flex items-start gap-2 rounded-lg border border-dashed p-3 text-sm text-muted-foreground">
      {icon}
      <p>{text}</p>
    </div>
  );
}

function FileTree({
  nodes,
  selected,
  onSelect,
  depth = 0,
}: {
  nodes: FileNode[];
  selected: string | null;
  onSelect: (path: string) => void;
  depth?: number;
}) {
  return (
    <ul className="space-y-0.5">
      {nodes.map((node) => (
        <li key={node.path}>
          <button
            type="button"
            onClick={() => (node.type === "file" ? onSelect(node.path) : undefined)}
            className={`flex w-full items-center gap-1.5 rounded-md px-1.5 py-1 text-left text-xs ${
              selected === node.path ? "bg-muted text-foreground" : "text-muted-foreground hover:bg-muted/60 hover:text-foreground"
            }`}
            style={{ paddingLeft: 6 + depth * 12 }}
          >
            {node.type === "dir" ? <Folder className="size-3.5" /> : <FileText className="size-3.5" />}
            {node.name}
          </button>
          {node.children?.length ? (
            <FileTree nodes={node.children} selected={selected} onSelect={onSelect} depth={depth + 1} />
          ) : null}
        </li>
      ))}
    </ul>
  );
}
