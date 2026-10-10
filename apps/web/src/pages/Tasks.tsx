import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import type { Item, ListWithItems } from "@/lib/api";
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
import { useListFilters } from "@/components/tasks/useListFilters";
import { ListFormDialog } from "@/components/tasks/ListFormDialog";
import { ItemFormDialog } from "@/components/tasks/ItemFormDialog";
import { EMPTY_ITEM_FORM, EMPTY_LIST_FORM, itemPayload, listPayload, type ItemFormValues, type ListFormValues } from "@/components/tasks/forms";
import { ConfirmDeleteDialog } from "@/components/tasks/ConfirmDeleteDialog";
import { useUndoableDelete } from "@/hooks/useUndoableDelete";

const Tasks = () => {
  const { data: lists = [], isLoading: listsLoading } = useLists();
  const createList = useCreateList();
  const updateList = useUpdateList();
  const deleteList = useDeleteList();
  const createItem = useCreateItem();
  const toggleItem = useToggleItem();
  const updateItem = useUpdateItem();
  const reorderItems = useReorderItems();
  const deleteItem = useDeleteItem();

  // /tasks?list=42 opens a quest directly (used by links from AI answers).
  const [searchParams] = useSearchParams();
  const [selectedListId, setSelectedListId] = useState<number | null>(() => Number(searchParams.get("list")) || null);
  const { data: selectedList, refetch: refetchList } = useList(selectedListId || 0);
  const filters = useListFilters(lists);

  const [listDialog, setListDialog] = useState<"create" | "edit" | null>(null);
  const [itemDialog, setItemDialog] = useState<{ mode: "create"; parentId?: number } | { mode: "edit"; item: Item } | null>(null);
  const { user } = useAuth();
  const [listToDelete, setListToDelete] = useState<number | null>(null);
  const itemDeletes = useUndoableDelete(async (id) => {
    await deleteItem.mutateAsync(id);
    refetchList();
  });

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
    if (!values.name.trim() || !selectedListId) return;
    try {
      await updateList.mutateAsync({ listId: selectedListId, data: listPayload(values) });
      toast.success("✏️ Quest updated!");
      setListDialog(null);
      refetchList();
    } catch { /* error toast shown by the mutation hook */ }
  };

  const handleSaveItem = async (values: ItemFormValues) => {
    if (!values.name.trim() || !selectedListId || !itemDialog) return;
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

  const handleQuickAdd = async (parsed: QuickAddResult) => {
    if (!selectedListId) return;
    try {
      await createItem.mutateAsync({ listId: selectedListId, name: parsed.name, due_date: parsed.due_date, priority: parsed.priority, tags: parsed.tags, recurrence: parsed.recurrence });
      refetchList();
    } catch { /* error toast shown by the mutation hook */ }
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
  const completeItems = async (ids: number[]) => {
    for (const id of ids) {
      try {
        await toggleItem.mutateAsync(id);
      } catch {
        break; // error toast shown by the mutation hook
      }
    }
    refetchList();
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
          aiEnabled={Boolean(user?.features?.ai)}
          quickAddPending={createItem.isPending}
          onAddItem={(parentId) => setItemDialog({ mode: "create", parentId })}
          onQuickAdd={handleQuickAdd}
          onEditList={() => setListDialog("edit")}
          onDeleteList={() => setListToDelete(detail.id)}
          onToggleItem={(id) => toggleItem.mutate(id)}
          onEditItem={openItemEditor}
          hiddenIds={itemDeletes.hidden}
          onDeleteItem={(id) => deleteItems([id])}
          onBulkComplete={completeItems}
          onBulkDelete={deleteItems}
          onReorder={async (itemIds) => {
            await reorderItems.mutateAsync({ listId: detail.id, itemIds });
            toast.success("Task reordered");
          }}
        />
      ) : (
        <ListOverview lists={lists} loading={listsLoading} filters={filters} onOpen={setSelectedListId} onCreate={() => setListDialog("create")} />
      )}

      <ListFormDialog
        open={listDialog !== null}
        onOpenChange={(open) => !open && setListDialog(null)}
        mode={listDialog ?? "create"}
        initial={listDialog === "edit" ? editListInitial : EMPTY_LIST_FORM}
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
