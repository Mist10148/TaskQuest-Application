import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import type { Item, ListWithItems } from "@/lib/api";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { dateOnly } from "@/lib/dates";
import {
  useLists, useList, useCreateList, useUpdateList, useDeleteList,
  useCreateItem, useToggleItem, useUpdateItem, useDeleteItem, useReorderItems,
} from "@/hooks/useApi";
import { ListOverview } from "@/components/tasks/ListOverview";
import { ListDetail } from "@/components/tasks/ListDetail";
import { useListFilters } from "@/components/tasks/useListFilters";
import { ListFormDialog } from "@/components/tasks/ListFormDialog";
import { ItemFormDialog } from "@/components/tasks/ItemFormDialog";
import { EMPTY_ITEM_FORM, EMPTY_LIST_FORM, listPayload, type ItemFormValues, type ListFormValues } from "@/components/tasks/forms";
import { ConfirmDeleteDialog } from "@/components/tasks/ConfirmDeleteDialog";

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
  const [itemDialog, setItemDialog] = useState<{ mode: "create" } | { mode: "edit"; item: Item } | null>(null);
  const [listToDelete, setListToDelete] = useState<number | null>(null);
  const [itemToDelete, setItemToDelete] = useState<number | null>(null);

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
  const itemInitial = useMemo<ItemFormValues>(
    () => (itemDialog?.mode === "edit" ? { name: itemDialog.item.name, description: itemDialog.item.description || "" } : EMPTY_ITEM_FORM),
    [itemDialog]
  );

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
    const data = { name: values.name.trim(), description: values.description.trim() || null };
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

  const confirmDeleteList = async () => {
    if (!listToDelete) return;
    try {
      await deleteList.mutateAsync(listToDelete);
      toast.success("🗑️ Quest deleted successfully");
      setSelectedListId(null);
      setListToDelete(null);
    } catch { /* error toast shown by the mutation hook */ }
  };

  const confirmDeleteItem = async () => {
    if (!itemToDelete) return;
    try {
      await deleteItem.mutateAsync(itemToDelete);
      toast.success("🗑️ Task deleted");
      setItemToDelete(null);
      refetchList();
    } catch { /* error toast shown by the mutation hook */ }
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
          onAddItem={() => setItemDialog({ mode: "create" })}
          onEditList={() => setListDialog("edit")}
          onDeleteList={() => setListToDelete(detail.id)}
          onToggleItem={(id) => toggleItem.mutate(id)}
          onEditItem={openItemEditor}
          onDeleteItem={setItemToDelete}
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
        pending={createItem.isPending || updateItem.isPending}
        onSubmit={handleSaveItem}
      />
      <ConfirmDeleteDialog
        open={itemToDelete !== null}
        onOpenChange={(open) => !open && setItemToDelete(null)}
        title="Delete Task"
        description="Are you sure you want to delete this task? This action cannot be undone."
        confirmLabel="Delete Task"
        pending={deleteItem.isPending}
        onConfirm={confirmDeleteItem}
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
