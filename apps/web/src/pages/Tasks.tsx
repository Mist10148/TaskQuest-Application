import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { itemsApi, type Item, type ListWithItems } from "@/lib/api";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { dateOnly } from "@/lib/dates";
import { useAuth } from "@/contexts/AuthContext";
import type { QuickAddResult } from "@/lib/quickAdd";
import {
  useLists, useList, useCreateList, useUpdateList, useDeleteList,
  useCreateItem, useToggleItem, useUpdateItem, useDeleteItem, useReorderItems,
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
import { saveTemplateProblem } from "@/lib/templates";
import { MembersDialog } from "@/components/tasks/MembersDialog";
import { canEditTasks, isAccessLost, roleOf } from "@/lib/sharing";
import { useQueryClient } from "@tanstack/react-query";

const Tasks = () => {
  const listsQuery = useLists();
  const lists = useMemo(() => listsQuery.data ?? [], [listsQuery.data]);
  const createList = useCreateList();
  const updateList = useUpdateList();
  const deleteList = useDeleteList();
  const createItem = useCreateItem();
  const toggleItem = useToggleItem();
  const updateItem = useUpdateItem();
  const reorderItems = useReorderItems();
  const deleteItem = useDeleteItem();

  // /tasks?list=42 opens a quest directly (used by links from AI answers).
  const [searchParams, setSearchParams] = useSearchParams();
  const [selectedListId, setSelectedListId] = useState<number | null>(() => Number(searchParams.get("list")) || null);
  const { data: selectedList, refetch: refetchList, isLoading: listLoading, isError: listFailed, error: listError, isFetching: listFetching } = useList(selectedListId || 0);
  const filters = useListFilters(lists);

  const [listDialog, setListDialog] = useState<"create" | "edit" | null>(null);
  const [itemDialog, setItemDialog] = useState<{ mode: "create"; parentId?: number } | { mode: "edit"; item: Item } | null>(null);
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
  }, [accessLost, selectedListId, qc]);
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
      if (selectedListId && selectedList && !canEditTasks(roleOf(selectedList))) toast("You only have view access to this quest.");
      else if (selectedListId) setItemDialog({ mode: "create" });
      else toast("Open a quest first, then press N or use Add Task.");
    }
    setSearchParams((prev) => { const next = new URLSearchParams(prev); next.delete("new"); return next; }, { replace: true });
  }, [wantsNew, selectedListId, selectedList, setSearchParams]);

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
    return { ...EMPTY_ITEM_FORM, parent_id: itemDialog?.mode === "create" && itemDialog.parentId ? String(itemDialog.parentId) : "none" };
  }, [itemDialog]);

  // A task can become a subtask of any other top-level task, unless it has subtasks itself.
  const parentOptions = useMemo(() => {
    const items = selectedList?.items ?? [];
    const editingId = itemDialog?.mode === "edit" ? itemDialog.item.id : null;
    if (editingId !== null && items.some((i: Item) => i.parent_id === editingId)) return [];
    return items.filter((i: Item) => !i.parent_id && i.id !== editingId).map((i: Item) => ({ id: i.id, name: i.name }));
  }, [selectedList, itemDialog]);

  const handleCreateList = async (values: ListFormValues) => {
    if (!values.name.trim()) return void toast.error("Enter a name");
    const { name, description, category, priority, deadline } = listPayload(values);
    try {
      await createList.mutateAsync({ name, description: description ?? undefined, category: category ?? undefined, priority: priority ?? undefined, deadline: deadline ?? undefined });
      setListDialog(null);
    } catch { /* error toast shown by the mutation hook */ }
  };

  const handleSaveList = async (values: ListFormValues) => {
    if (!values.name.trim()) return void toast.error("Enter a name");
    if (!selectedListId) return;
    try {
      await updateList.mutateAsync({ listId: selectedListId, data: listPayload(values) });
      toast.success("✏️ Quest updated!");
      setListDialog(null);
      refetchList();
    } catch { /* error toast shown by the mutation hook */ }
  };

  const handleSaveItem = async (values: ItemFormValues) => {
    if (!values.name.trim()) return void toast.error("Enter a name");
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
    let done = 0;
    let xp = 0;
    for (const id of ids) {
      try {
        const result = await toggleItem.mutateAsync({ itemId: id, quiet: true });
        if (result.completed) {
          done += 1;
          xp += result.xpResult?.finalXP ?? 0;
        }
      } catch {
        break; // error toast shown by the mutation hook
      }
    }
    if (done > 0) toast.success(`✨ ${done} ${done === 1 ? "task" : "tasks"} done${xp > 0 ? ` +${xp} XP!` : ""}`);
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

  return (
    <DashboardLayout>
      {detail ? (
        <ListDetail
          list={detail}
          onBack={() => setSelectedListId(null)}
          onOpenMembers={() => setMembersOpen(true)}
          aiEnabled={Boolean(user?.features?.ai)}
          quickAddPending={createItem.isPending}
          onAddItem={(parentId) => setItemDialog({ mode: "create", parentId })}
          onQuickAdd={handleQuickAdd}
          onEditList={() => setListDialog("edit")}
          onSaveTemplate={() => {
            const problem = saveTemplateProblem(detail.items.length);
            if (problem) toast.error(problem);
            else setSaveTemplateOpen(true);
          }}
          onDeleteList={() => setListToDelete(detail.id)}
          onToggleItem={handleToggleItem}
          onEditItem={openItemEditor}
          hiddenIds={itemDeletes.hidden}
          onDeleteItem={(id) => deleteItems([id])}
          onBulkComplete={completeItems}
          onBulkDelete={deleteItems}
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
        <ListOverview lists={lists} loading={listsQuery.isLoading} error={listsQuery.isError ? listsQuery.error : null} onRetry={() => void listsQuery.refetch()} retrying={listsQuery.isFetching} filters={filters} onOpen={setSelectedListId} onCreate={() => setListDialog("create")} onOpenTemplates={() => setTemplatesOpen(true)} />
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
        title="Delete Quest"
        description={
          <>
            Are you sure you want to delete <span className="font-semibold text-foreground">"{selectedList?.name}"</span>? All tasks within this quest will also be deleted.
          </>
        }
        confirmLabel="Delete Quest"
        pending={deleteList.isPending}
        onConfirm={confirmDeleteList}
      />
    </DashboardLayout>
  );
};

export default Tasks;
