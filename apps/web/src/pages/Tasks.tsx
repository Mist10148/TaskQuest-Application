import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { itemsApi, type Item, type ListWithItems } from "@/lib/api";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { addDays, dateOnly, localToday } from "@/lib/dates";
import { useAuth } from "@/contexts/AuthContext";
import type { QuickAddResult } from "@/lib/quickAdd";
import {
  useLists, useList, useCreateList, useUpdateList, useDeleteList,
  useCreateItem, useToggleItem, useUpdateItem, useDeleteItem, useReorderItems, useMoveItem, useListMembers, invalidateProgress,
} from "@/hooks/useApi";
import { ListOverview } from "@/components/tasks/ListOverview";
import { ListDetail } from "@/components/tasks/ListDetail";
import { ErrorCard } from "@/components/feedback/ErrorCard";
import { Button } from "@/components/ui/button";
import { useListFilters } from "@/components/tasks/useListFilters";
import { ListFormDialog } from "@/components/tasks/ListFormDialog";
import { ItemFormDialog } from "@/components/tasks/ItemFormDialog";
import { EMPTY_ITEM_FORM, EMPTY_LIST_FORM, itemPayload, listPayload, type ItemFormValues, type ListFormValues } from "@/components/tasks/forms";
import { ConfirmDeleteDialog } from "@/components/tasks/ConfirmDeleteDialog";
import { useUndoableDelete } from "@/hooks/useUndoableDelete";
import { TemplatesDialog } from "@/components/tasks/TemplatesDialog";
import { SaveTemplateDialog } from "@/components/tasks/SaveTemplateDialog";
import { bulkPatch, tooManyTags, type BulkEditValues } from "@/lib/bulkEdit";
import { MAX_TAGS, parseTags } from "@/lib/tags";
import { saveTemplateProblem } from "@/lib/templates";
import { MembersDialog } from "@/components/tasks/MembersDialog";
import { canEditTasks, idFromParam, isAccessLost, roleOf } from "@/lib/sharing";
import { useQueryClient } from "@tanstack/react-query";
import { useT } from "@/i18n/useT";

/** Batches go one task at a time; from this size on, a loading toast counts them so a long batch does not look stuck. */
const BULK_PROGRESS_FROM = 3;

/** A "Completing 3 of 12…" toast for a batch, replaced by the summary toast (or removed) when it ends. */
function bulkProgress(verb: string, total: number) {
  if (total < BULK_PROGRESS_FROM) return { step: () => {}, end: () => {} };
  const id = toast.loading(`${verb} 1 of ${total}…`);
  return {
    step: (n: number) => void toast.loading(`${verb} ${Math.min(n + 1, total)} of ${total}…`, { id }),
    end: () => toast.dismiss(id),
  };
}

const Tasks = () => {
  const t = useT();
  const listsQuery = useLists();
  const lists = useMemo(() => listsQuery.data ?? [], [listsQuery.data]);
  const createList = useCreateList();
  const updateList = useUpdateList();
  const deleteList = useDeleteList();
  const createItem = useCreateItem();
  const toggleItem = useToggleItem();
  const updateItem = useUpdateItem();
  const moveItem = useMoveItem();
  const reorderItems = useReorderItems();
  const deleteItem = useDeleteItem();

  // The open quest lives in the URL (/tasks?list=42): links from AI answers open it, refresh keeps it,
  // and the browser's Back button returns to the quest log. Opening adds a history entry; closing replaces it.
  const [searchParams, setSearchParams] = useSearchParams();
  // Only a plain positive id in the database's range opens a quest: "-3", "1.5" or 3000000000 would otherwise show an error
  // with a Retry that cannot work.
  const selectedListId = idFromParam(searchParams.get("list"));
  const setSelectedListId = useCallback((id: number | null) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (id) next.set("list", String(id));
      else {
        next.delete("list");
        next.delete("task");
      }
      return next;
    }, { replace: id === null });
  }, [setSearchParams]);
  // /tasks?list=42&task=7 opens the quest with that task's drawer (links from search results and the command palette).
  const openTaskId = idFromParam(searchParams.get("task"));
  const openListAndTask = useCallback((listId: number, taskId?: number) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set("list", String(listId));
      if (taskId) next.set("task", String(taskId));
      else next.delete("task");
      return next;
    });
  }, [setSearchParams]);
  const clearTaskParam = useCallback(() => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.delete("task");
      return next;
    }, { replace: true });
  }, [setSearchParams]);
  const { data: selectedList, refetch: refetchList, isLoading: listLoading, isError: listFailed, error: listError, isFetching: listFetching } = useList(selectedListId || 0);
  const filters = useListFilters(lists);

  const [listDialog, setListDialog] = useState<"create" | "edit" | null>(null);
  const [itemDialog, setItemDialog] = useState<{ mode: "create"; parentId?: number; dueDate?: string } | { mode: "edit"; item: Item } | null>(null);
  const { user } = useAuth();
  const [listToDelete, setListToDelete] = useState<number | null>(null);
  const [templatesOpen, setTemplatesOpen] = useState(false);
  const [saveTemplateOpen, setSaveTemplateOpen] = useState(false);
  const [membersOpen, setMembersOpen] = useState(false);
  const qc = useQueryClient();

  // The quest is gone, or I was removed from it while it was open: say so, drop the stale data and go back to the quest log.
  const accessLost = selectedListId !== null && listFailed && isAccessLost(listError);
  useEffect(() => {
    if (!accessLost || selectedListId === null) return;
    toast.error("That quest was not found, or you no longer have access to it.");
    qc.removeQueries({ queryKey: ["lists", selectedListId] });
    void qc.invalidateQueries({ queryKey: ["lists"] });
    setMembersOpen(false);
    setSelectedListId(null);
  }, [accessLost, selectedListId, qc, setSelectedListId]);
  const itemDeletes = useUndoableDelete(
    async (id) => {
      await deleteItem.mutateAsync(id);
      refetchList();
    },
    undefined,
    (id) => itemsApi.delete(id, { keepalive: true }),
  );

  // /tasks?new=quest or ?new=task comes from the command palette: open the matching dialog, then drop the param.
  const wantsNew = searchParams.get("new");
  useEffect(() => {
    if (!wantsNew) return;
    if (wantsNew === "quest") setListDialog("create");
    else if (wantsNew === "task") {
      // Until the open quest has loaded its role is unknown: wait for it, or a viewer gets a form the server then refuses.
      // If it failed to load, drop the param, or a later successful Retry would pop the form open out of nowhere.
      if (selectedListId && !selectedList) {
        if (!listFailed) return; // still loading; a failed load has its own error card
      } else if (selectedListId && selectedList && !canEditTasks(roleOf(selectedList))) toast("You only have view access to this quest.");
      else if (selectedListId) setItemDialog({ mode: "create" });
      else toast("Open a quest first, then press N or use Add Task.");
    }
    setSearchParams((prev) => { const next = new URLSearchParams(prev); next.delete("new"); return next; }, { replace: true });
  }, [wantsNew, selectedListId, selectedList, listFailed, setSearchParams]);

  const editListInitial = useMemo<ListFormValues>(
    () =>
      selectedList
        ? {
            name: selectedList.name,
            description: selectedList.description || "",
            category: selectedList.category || "none",
            priority: selectedList.priority || "none",
            deadline: dateOnly(selectedList.deadline),
          }
        : EMPTY_LIST_FORM,
    [selectedList]
  );
  const itemInitial = useMemo<ItemFormValues>(() => {
    if (itemDialog?.mode === "edit") {
      const i = itemDialog.item;
      return {
        name: i.name,
        description: i.description || "",
        due_date: dateOnly(i.due_date),
        priority: i.priority || "none",
        tags: i.tags ? i.tags.split(",").join(", ") : "",
        recurrence: i.recurrence || "none",
        estimate: i.estimate_minutes ? String(i.estimate_minutes) : "",
        parent_id: i.parent_id ? String(i.parent_id) : "none",
      };
    }
    const create = itemDialog?.mode === "create" ? itemDialog : null;
    return { ...EMPTY_ITEM_FORM, parent_id: create?.parentId ? String(create.parentId) : "none", due_date: create?.dueDate ?? EMPTY_ITEM_FORM.due_date };
  }, [itemDialog]);

  // A task can become a subtask of any other top-level task, unless it has subtasks itself.
  const parentOptions = useMemo(() => {
    const items = selectedList?.items ?? [];
    const editingId = itemDialog?.mode === "edit" ? itemDialog.item.id : null;
    if (editingId !== null && items.some((i: Item) => i.parent_id === editingId)) return [];
    return items.filter((i: Item) => !i.parent_id && i.id !== editingId).map((i: Item) => ({ id: i.id, name: i.name }));
  }, [selectedList, itemDialog]);

  const handleCreateList = async (values: ListFormValues) => {
    if (!values.name.trim()) return; // the dialog shows the error inline
    const { name, description, category, priority, deadline } = listPayload(values);
    try {
      await createList.mutateAsync({ name, description: description ?? undefined, category: category ?? undefined, priority: priority ?? undefined, deadline: deadline ?? undefined });
      setListDialog(null);
    } catch { /* error toast shown by the mutation hook */ }
  };

  const handleSaveList = async (values: ListFormValues) => {
    if (!values.name.trim()) return; // the dialog shows the error inline
    if (!selectedListId) return;
    try {
      await updateList.mutateAsync({ listId: selectedListId, data: listPayload(values) });
      toast.success("✏️ Quest updated!");
      setListDialog(null);
      refetchList();
    } catch { /* error toast shown by the mutation hook */ }
  };

  const handleSaveItem = async (values: ItemFormValues) => {
    if (!values.name.trim()) return; // the dialog shows the error inline
    if (!selectedListId || !itemDialog) return;
    const data = itemPayload(values);
    try {
      if (itemDialog.mode === "create") {
        await createItem.mutateAsync({ listId: selectedListId, ...data });
      } else {
        await updateItem.mutateAsync({ itemId: itemDialog.item.id, data });
        toast.success("✏️ Task updated");
      }
      setItemDialog(null);
      refetchList();
    } catch { /* error toast shown by the mutation hook */ }
  };

  const handleQuickAdd = async (parsed: QuickAddResult): Promise<boolean> => {
    if (!selectedListId) return false;
    try {
      await createItem.mutateAsync({ listId: selectedListId, name: parsed.name, due_date: parsed.due_date, priority: parsed.priority, tags: parsed.tags, recurrence: parsed.recurrence });
      refetchList();
      return true;
    } catch {
      return false; // error toast shown by the mutation hook; the bar keeps the text
    }
  };

  const confirmDeleteList = async () => {
    if (!listToDelete) return;
    try {
      await deleteList.mutateAsync(listToDelete);
      toast.success("🗑️ Quest deleted successfully");
      setSelectedListId(null);
      setListToDelete(null);
    } catch { /* error toast shown by the mutation hook */ }
  };

  const nameOf = (id: number) => selectedList?.items.find((i: Item) => i.id === id)?.name ?? "task";
  const deleteItems = (ids: number[]) =>
    itemDeletes.request(ids, ids.length === 1 ? `Deleted "${nameOf(ids[0])}"` : `Deleted ${ids.length} tasks`);

  // Complete one after another so each task pays its own XP and achievements.
  // The reward toasts are folded into one summary for the batch.
  const completeItems = async (ids: number[]) => {
    const finished: number[] = [];
    let xp = 0;
    const progress = bulkProgress("Completing", ids.length);
    for (const [n, id] of ids.entries()) {
      progress.step(n);
      try {
        const result = await toggleItem.mutateAsync({ itemId: id, completed: true, quiet: true });
        if (result.completed) {
          finished.push(id);
          xp += result.xpResult?.finalXP ?? 0;
        }
      } catch {
        break; // error toast shown by the mutation hook
      }
    }
    progress.end();
    const done = finished.length;
    // Undo un-checks the batch again, like Undo on one task: the XP stays paid (once per task), and a repeating task's next copy
    // is removed again while nobody has touched it (the server decides).
    const undo = async () => {
      let failed = false;
      for (const id of finished) await itemsApi.toggle(id, false).catch(() => (failed = true));
      if (failed) toast.error("Some tasks could not be reopened.");
      refetchList();
      // Quests, the weekly review, Today, the party and the profile totals count finished tasks too.
      qc.invalidateQueries({ queryKey: ["lists"] });
      invalidateProgress(qc);
    };
    if (done > 0) toast.success(`✨ ${done} ${done === 1 ? "task" : "tasks"} done${xp > 0 ? ` +${xp} XP!` : ""}`, { action: { label: "Undo", onClick: () => void undo() }, duration: 6000 });
    refetchList();
  };

  // One update per task (the same endpoint as the edit form), one toast at the end.
  const editItems = async (ids: number[], values: BulkEditValues) => {
    if (!bulkPatch(values)) return;
    let done = 0;
    let tooMany = 0;
    const progress = bulkProgress("Updating", ids.length);
    for (const [n, id] of ids.entries()) {
      progress.step(n);
      // Adding or removing tags depends on each task's own tags, so every task gets its own patch.
      const current = parseTags(selectedList?.items.find((i: Item) => i.id === id)?.tags);
      if (tooManyTags(values, current)) {
        tooMany += 1;
        continue;
      }
      const data = bulkPatch(values, current);
      if (!data) continue; // nothing would change for this task
      try {
        await updateItem.mutateAsync({ itemId: id, data });
        done += 1;
      } catch {
        break; // error toast shown by the mutation hook
      }
    }
    progress.end();
    if (done > 0) toast.success(`✏️ ${done} ${done === 1 ? "task" : "tasks"} updated${done < ids.length ? ` (${ids.length - done} not changed)` : ""}`);
    if (tooMany > 0) toast.warning(`${tooMany} ${tooMany === 1 ? "task was" : "tasks were"} skipped: a task can have at most ${MAX_TAGS} tags.`);
    refetchList();
  };

  // Send the wanted state explicitly and ignore clicks while that task's toggle is in flight.
  const togglingIds = useRef(new Set<number>());
  const handleToggleItem = (id: number) => {
    const item = selectedList?.items.find((i: Item) => i.id === id);
    if (!item || togglingIds.current.has(id)) return;
    togglingIds.current.add(id);
    // mutate()'s per-call callbacks only fire for the latest call, so release the guard on the promise.
    toggleItem.mutateAsync({ itemId: id, completed: !item.completed })
      .catch(() => { /* error toast shown by the mutation hook */ })
      .finally(() => togglingIds.current.delete(id));
  };

  const openItemEditor = (itemId: number) => {
    const item = selectedList?.items.find((i: Item) => i.id === itemId);
    if (item) setItemDialog({ mode: "edit", item });
  };

  const detail: ListWithItems | undefined = selectedListId ? selectedList : undefined;
  // People a task can be assigned to: only a shared quest has anyone besides the owner.
  const membersQuery = useListMembers(detail?.id ?? 0, Boolean(detail?.shared));
  const assignOptions = detail?.shared ? membersQuery.data?.members : undefined;
  // Quests a task can move to: any other quest I may add tasks to.
  const moveTargets = useMemo(
    () => lists.filter((l) => l.id !== detail?.id && canEditTasks(roleOf(l))).map((l) => ({ id: l.id, name: l.name })),
    [lists, detail?.id]
  );

  const moveItems = async (ids: number[], listId: number) => {
    const target = lists.find((l) => l.id === listId)?.name ?? "the other quest";
    let done = 0;
    const progress = bulkProgress("Moving", ids.length);
    for (const [n, id] of ids.entries()) {
      progress.step(n);
      try {
        await moveItem.mutateAsync({ itemId: id, listId });
        done += 1;
      } catch {
        break; // error toast shown by the mutation hook
      }
    }
    progress.end();
    if (done > 0) toast.success(`📦 Moved ${done === 1 ? `"${nameOf(ids[0])}"` : `${done} tasks`} to ${target}`);
  };

  return (
    <DashboardLayout>
      {detail ? (
        <ListDetail
          // A new quest starts with fresh view state: select mode, the keyboard cursor and a pending bulk confirm stay behind.
          key={detail.id}
          list={detail}
          openTaskId={openTaskId}
          onTaskOpened={clearTaskParam}
          onBack={() => setSelectedListId(null)}
          onOpenMembers={() => setMembersOpen(true)}
          aiEnabled={Boolean(user?.features?.ai)}
          quickAddPending={createItem.isPending}
          onAddItem={(parentId, dueDate) => setItemDialog({ mode: "create", parentId, dueDate })}
          onQuickAdd={handleQuickAdd}
          onEditList={() => setListDialog("edit")}
          onSaveTemplate={() => {
            const problem = saveTemplateProblem(detail.items.length);
            if (problem) toast.error(problem);
            else setSaveTemplateOpen(true);
          }}
          onDeleteList={() => setListToDelete(detail.id)}
          onToggleItem={handleToggleItem}
          onSetPriority={(itemId, priority) => updateItem.mutate({ itemId, data: { priority } })}
          onSnooze={(itemId) =>
            updateItem.mutate({ itemId, data: { due_date: addDays(localToday(), 1) } }, { onSuccess: () => toast.success("Snoozed to tomorrow") })
          }
          assignOptions={assignOptions}
          onAssign={(itemId, memberKey) => updateItem.mutateAsync({ itemId, data: { assignee: memberKey } })}
          moveTargets={moveTargets}
          onMove={moveItems}
          onEditItem={openItemEditor}
          hiddenIds={itemDeletes.hidden}
          onDeleteItem={(id) => deleteItems([id])}
          onBulkComplete={completeItems}
          onBulkDelete={deleteItems}
          onBulkEdit={editItems}
          onReorder={(itemIds) => reorderItems.mutateAsync({ listId: detail.id, itemIds })}
        />
      ) : selectedListId ? (
        listLoading ? (
          <div className="space-y-4" aria-busy="true" aria-live="polite">
            <div className="h-8 w-64 rounded-lg bg-background-secondary animate-pulse" />
            <div className="h-20 rounded-xl bg-background-secondary animate-pulse" />
            {[0, 1, 2].map((n) => <div key={n} className="h-14 rounded-xl bg-background-secondary animate-pulse" />)}
          </div>
        ) : (
          <div className="space-y-4">
            <ErrorCard what="this quest" error={listFailed ? listError : new Error("Quest not found.")} onRetry={() => void refetchList()} retrying={listFetching} />
            <div className="text-center"><Button variant="outline" size="sm" onClick={() => setSelectedListId(null)}>Back to Quests</Button></div>
          </div>
        )
      ) : (
        <ListOverview lists={lists} loading={listsQuery.isLoading} error={listsQuery.isError ? listsQuery.error : null} onRetry={() => void listsQuery.refetch()} retrying={listsQuery.isFetching} filters={filters} onOpen={openListAndTask} onCreate={() => setListDialog("create")} onOpenTemplates={() => setTemplatesOpen(true)} aiEnabled={Boolean(user?.features?.ai)} />
      )}

      <ListFormDialog
        open={listDialog !== null}
        onOpenChange={(open) => !open && setListDialog(null)}
        mode={listDialog ?? "create"}
        initial={listDialog === "edit" ? editListInitial : EMPTY_LIST_FORM}
        resetKey={listDialog === "edit" ? selectedListId : null}
        pending={createList.isPending || updateList.isPending}
        onSubmit={listDialog === "edit" ? handleSaveList : handleCreateList}
      />
      <ItemFormDialog
        open={itemDialog !== null}
        onOpenChange={(open) => !open && setItemDialog(null)}
        mode={itemDialog?.mode ?? "create"}
        initial={itemInitial}
        parentOptions={parentOptions}
        pending={createItem.isPending || updateItem.isPending}
        onSubmit={handleSaveItem}
      />
      <TemplatesDialog open={templatesOpen} onOpenChange={setTemplatesOpen} onApplied={setSelectedListId} />
      {detail && (
        <MembersDialog
          open={membersOpen}
          onOpenChange={setMembersOpen}
          listId={detail.id}
          listName={detail.name}
          onAccessLost={() => {
            setMembersOpen(false);
            setSelectedListId(null);
            void qc.invalidateQueries({ queryKey: ["lists"] });
          }}
        />
      )}
      {detail && <SaveTemplateDialog open={saveTemplateOpen} onOpenChange={setSaveTemplateOpen} listId={detail.id} listName={detail.name} />}
      <ConfirmDeleteDialog
        open={listToDelete !== null}
        onOpenChange={(open) => !open && setListToDelete(null)}
        title={t("quest.deleteTitle")}
        description={
          <>
            {t("quest.deleteBefore")}<span className="font-semibold text-foreground">"{selectedList?.name}"</span>{t("quest.deleteAfter")}
          </>
        }
        confirmLabel={t("quest.deleteConfirm")}
        pending={deleteList.isPending}
        onConfirm={confirmDeleteList}
      />
    </DashboardLayout>
  );
};

export default Tasks;
