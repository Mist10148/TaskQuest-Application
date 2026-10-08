import type { Item, ListWithCounts, Priority } from "@/lib/api";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { TaskListCard, TaskItem } from "@/components/game/TaskComponents";
import { Button } from "@/components/ui/button";
import { motion } from "framer-motion";
import { useState } from "react";
import { Plus, Search, Filter, SortAsc, ArrowLeft, Loader2, AlertCircle, X, Check, Calendar, Trash2, Pencil, Scroll, Clock, CheckCircle2, ListTodo } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useLists, useList, useCreateList, useUpdateList, useDeleteList, useCreateItem, useToggleItem, useUpdateItem, useDeleteItem } from "@/hooks/useApi";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

const CATEGORIES = [
  { value: 'all', label: 'All Categories', emoji: '📋' },
  { value: 'none', label: 'None', emoji: '➖' },
  { value: 'School', label: 'School', emoji: '📚' },
  { value: 'Work', label: 'Work', emoji: '💼' },
  { value: 'Personal', label: 'Personal', emoji: '🏠' },
  { value: 'Health', label: 'Health', emoji: '💪' },
  { value: 'Finance', label: 'Finance', emoji: '💰' },
  { value: 'Shopping', label: 'Shopping', emoji: '🛒' },
  { value: 'Fitness', label: 'Fitness', emoji: '🏃' },
  { value: 'Other', label: 'Other', emoji: '📌' },
];

const PRIORITIES = [
  { value: 'all', label: 'All', emoji: '🔘' },
  { value: 'none', label: 'None', emoji: '➖' },
  { value: 'HIGH', label: 'High', emoji: '🔴' },
  { value: 'MEDIUM', label: 'Medium', emoji: '🟡' },
  { value: 'LOW', label: 'Low', emoji: '🔵' },
];

const SORT_OPTIONS = [
  { value: 'newest', label: '📅 Newest First' },
  { value: 'oldest', label: '📅 Oldest First' },
  { value: 'name_asc', label: '🔤 Name A-Z' },
  { value: 'name_desc', label: '🔤 Name Z-A' },
  { value: 'priority', label: '⚡ Priority' },
  { value: 'deadline', label: '⏰ Deadline' },
];

const PRIORITY_ORDER: Record<string, number> = { HIGH: 0, MEDIUM: 1, LOW: 2 };

const Tasks = () => {
  const { data: lists = [], isLoading: listsLoading } = useLists();
  const createList = useCreateList();
  const updateList = useUpdateList();
  const deleteList = useDeleteList();
  const createItem = useCreateItem();
  const toggleItem = useToggleItem();
  const updateItem = useUpdateItem();
  const deleteItem = useDeleteItem();

  const [selectedListId, setSelectedListId] = useState<number | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [priorityFilter, setPriorityFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [activeTab, setActiveTab] = useState<"all" | "current" | "expired" | "completed">("all");
  const [sortBy, setSortBy] = useState("newest");
  
  // Create list state
  const [showCreateList, setShowCreateList] = useState(false);
  const [newListName, setNewListName] = useState("");
  const [newListDesc, setNewListDesc] = useState("");
  const [newListCategory, setNewListCategory] = useState("none");
  const [newListPriority, setNewListPriority] = useState("none");
  const [newListDeadline, setNewListDeadline] = useState("");
  
  // Edit list state
  const [showEditList, setShowEditList] = useState(false);
  const [editListName, setEditListName] = useState("");
  const [editListDesc, setEditListDesc] = useState("");
  const [editListCategory, setEditListCategory] = useState("none");
  const [editListPriority, setEditListPriority] = useState("none");
  const [editListDeadline, setEditListDeadline] = useState("");

  // Add item state
  const [showAddItem, setShowAddItem] = useState(false);
  const [newItemName, setNewItemName] = useState("");
  const [newItemDesc, setNewItemDesc] = useState("");

  // Delete confirmation state
  const [showDeleteListConfirm, setShowDeleteListConfirm] = useState(false);
  const [listToDelete, setListToDelete] = useState<number | null>(null);
  
  // Task edit/delete state
  const [showEditItem, setShowEditItem] = useState(false);
  const [editingItem, setEditingItem] = useState<Item | null>(null);
  const [editItemName, setEditItemName] = useState("");
  const [editItemDesc, setEditItemDesc] = useState("");
  const [showDeleteItemConfirm, setShowDeleteItemConfirm] = useState(false);
  const [itemToDelete, setItemToDelete] = useState<number | null>(null);

  const { data: selectedListData, refetch: refetchList } = useList(selectedListId || 0);

  // Filtering & Sorting
  const filteredAndSortedLists = (lists || [])
    .filter(list => {
      if (!searchQuery) return true;
      const query = searchQuery.toLowerCase();
      return list.name.toLowerCase().includes(query) || list.category?.toLowerCase().includes(query);
    })
    .filter(list => categoryFilter === 'all' || (categoryFilter === 'none' ? !list.category : list.category === categoryFilter))
    .filter(list => priorityFilter === 'all' || (priorityFilter === 'none' ? !list.priority : list.priority === priorityFilter))
    .filter(list => {
      if (statusFilter === 'all') return true;
      const isComplete = list.itemsTotal > 0 && list.itemsCompleted === list.itemsTotal;
      return statusFilter === 'completed' ? isComplete : !isComplete;
    })
    .filter(list => {
      if (activeTab === 'all') return true;

      const isComplete = list.itemsTotal > 0 && list.itemsCompleted === list.itemsTotal;
      const now = new Date();
      const isExpired = list.deadline && new Date(list.deadline) < now && !isComplete;

      if (activeTab === 'completed') return isComplete;
      if (activeTab === 'expired') return isExpired;
      if (activeTab === 'current') return !isComplete && !isExpired;
      return true;
    })
    .sort((a, b) => {
      switch (sortBy) {
        case 'newest': return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
        case 'oldest': return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
        case 'name_asc': return a.name.localeCompare(b.name);
        case 'name_desc': return b.name.localeCompare(a.name);
        case 'priority': return (PRIORITY_ORDER[a.priority || ''] ?? 3) - (PRIORITY_ORDER[b.priority || ''] ?? 3);
        case 'deadline':
          if (!a.deadline && !b.deadline) return 0;
          if (!a.deadline) return 1;
          if (!b.deadline) return -1;
          return new Date(a.deadline).getTime() - new Date(b.deadline).getTime();
        default: return 0;
      }
    });

  const handleCreateList = async () => {
    if (!newListName.trim()) { toast.error('Enter a name'); return; }
    try {
      await createList.mutateAsync({
        name: newListName.trim(),
        description: newListDesc.trim() || undefined,
        category: newListCategory !== 'none' ? newListCategory : undefined,
        priority: newListPriority !== 'none' ? (newListPriority as Priority) : undefined,
        deadline: newListDeadline || undefined,
      });
      // XP notification handled by hook
      setShowCreateList(false);
      setNewListName(""); setNewListDesc(""); setNewListCategory("none"); setNewListPriority("none"); setNewListDeadline("");
    } catch { /* error toast shown by the mutation hook */ }
  };

  // Edit list handlers
  const handleEditListClick = () => {
    if (selectedListData) {
      setEditListName(selectedListData.name);
      setEditListDesc(selectedListData.description || "");
      setEditListCategory(selectedListData.category || "none");
      setEditListPriority(selectedListData.priority || "none");
      setEditListDeadline(selectedListData.deadline ? selectedListData.deadline.split('T')[0] : "");
      setShowEditList(true);
    }
  };

  const handleSaveList = async () => {
    if (!editListName.trim() || !selectedListId) return;
    try {
      await updateList.mutateAsync({
        listId: selectedListId,
        data: {
          name: editListName.trim(),
          description: editListDesc.trim() || null,
          category: editListCategory !== 'none' ? editListCategory : null,
          priority: editListPriority !== 'none' ? (editListPriority as Priority) : null,
          deadline: editListDeadline || null,
        }
      });
      toast.success('✏️ Quest updated!');
      setShowEditList(false);
      refetchList();
    } catch { /* error toast shown by the mutation hook */ }
  };

  const handleAddItem = async () => {
    if (!newItemName.trim() || !selectedListId) return;
    try {
      await createItem.mutateAsync({ listId: selectedListId, name: newItemName.trim(), description: newItemDesc.trim() || undefined });
      // XP notification handled by hook
      setShowAddItem(false);
      setNewItemName(""); setNewItemDesc("");
    } catch { /* error toast shown by the mutation hook */ }
  };

  const handleToggleItem = async (itemId: number) => {
    try {
      await toggleItem.mutateAsync(itemId);
      // XP notification handled by hook
    } catch { /* error toast shown by the mutation hook */ }
  };

  const handleDeleteListClick = (listId: number) => {
    setListToDelete(listId);
    setShowDeleteListConfirm(true);
  };

  const handleDeleteListConfirm = async () => {
    if (!listToDelete) return;
    try {
      await deleteList.mutateAsync(listToDelete);
      toast.success('🗑️ Quest deleted successfully');
      setSelectedListId(null);
      setShowDeleteListConfirm(false);
      setListToDelete(null);
    } catch { /* error toast shown by the mutation hook */ }
  };

  const handleEditItemClick = (itemId: number) => {
    const items = selectedListData?.items || [];
    const item = items.find((i: Item) => i.id === itemId);
    if (item) {
      setEditingItem(item);
      setEditItemName(item.name);
      setEditItemDesc(item.description || "");
      setShowEditItem(true);
    }
  };

  const handleSaveItem = async () => {
    if (!editingItem || !editItemName.trim()) return;
    try {
      await updateItem.mutateAsync({ itemId: editingItem.id, data: { name: editItemName.trim(), description: editItemDesc.trim() || null } });
      toast.success('✏️ Task updated');
      setShowEditItem(false);
      setEditingItem(null);
      refetchList();
    } catch { /* error toast shown by the mutation hook */ }
  };

  const handleDeleteItemClick = (itemId: number) => {
    setItemToDelete(itemId);
    setShowDeleteItemConfirm(true);
  };

  const handleDeleteItemConfirm = async () => {
    if (!itemToDelete) return;
    try {
      await deleteItem.mutateAsync(itemToDelete);
      toast.success('🗑️ Task deleted');
      setShowDeleteItemConfirm(false);
      setItemToDelete(null);
      refetchList();
    } catch { /* error toast shown by the mutation hook */ }
  };

  const [draggedItemId, setDraggedItemId] = useState<number | null>(null);
  const [dragOverItemId, setDragOverItemId] = useState<number | null>(null);

  const handleDragStart = (e: React.DragEvent, itemId: number) => {
    setDraggedItemId(itemId);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', String(itemId));
    // Add drag image styling
    const target = e.currentTarget as HTMLElement;
    target.style.opacity = '0.5';
  };

  const handleDragEnd = (e: React.DragEvent) => {
    const target = e.currentTarget as HTMLElement;
    target.style.opacity = '1';
    setDraggedItemId(null);
    setDragOverItemId(null);
  };

  const handleDragOver = (e: React.DragEvent, itemId: number) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (draggedItemId && draggedItemId !== itemId) {
      setDragOverItemId(itemId);
    }
  };

  const handleDragLeave = () => {
    setDragOverItemId(null);
  };

  const handleDrop = async (e: React.DragEvent, targetItemId: number) => {
    e.preventDefault();
    setDragOverItemId(null);
    
    if (!draggedItemId || draggedItemId === targetItemId) {
      setDraggedItemId(null);
      return;
    }
    
    const items = selectedListData?.items || [];
    const draggedIndex = items.findIndex((i: Item) => i.id === draggedItemId);
    const targetIndex = items.findIndex((i: Item) => i.id === targetItemId);
    
    if (draggedIndex === -1 || targetIndex === -1) {
      setDraggedItemId(null);
      return;
    }

    // Reorder items locally first for instant feedback
    const newItems = [...items];
    const [draggedItem] = newItems.splice(draggedIndex, 1);
    newItems.splice(targetIndex, 0, draggedItem);

    // Update positions for all affected items
    try {
      // Update the dragged item's position to the target's position
      const newPosition = targetIndex + 1;
      await updateItem.mutateAsync({ 
        itemId: draggedItemId, 
        data: { position: newPosition } 
      });
      toast.success('Task reordered');
      refetchList();
    } catch { 
      toast.error('Failed to reorder'); 
    }
    
    setDraggedItemId(null);
  };

  const activeFilters = [categoryFilter !== 'all', priorityFilter !== 'all', statusFilter !== 'all'].filter(Boolean).length;

  // LIST DETAIL VIEW
  if (selectedListId && selectedListData) {
    const items = selectedListData.items || [];
    const completed = items.filter((i: Item) => i.completed).length;
    const progress = items.length > 0 ? (completed / items.length) * 100 : 0;

    return (
      <DashboardLayout>
        <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} className="px-4 sm:px-0">
          <div className="mb-6">
            <button onClick={() => setSelectedListId(null)} className="flex items-center gap-2 text-foreground-muted hover:text-foreground mb-4 text-sm group">
              <ArrowLeft className="h-4 w-4 group-hover:-translate-x-1 transition-transform" /> Back to Quests
            </button>
            <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
              <div>
                <div className="flex items-center gap-3 flex-wrap">
                  <h1 className="text-2xl sm:text-3xl font-heading font-bold bg-gradient-to-r from-foreground to-foreground/70 bg-clip-text">{selectedListData.name}</h1>
                  {selectedListData.priority && (
                    <span className={cn("text-xs px-2 py-1 rounded-full font-medium", 
                      selectedListData.priority === 'HIGH' ? 'bg-red-500/20 text-red-400 border border-red-500/30' :
                      selectedListData.priority === 'MEDIUM' ? 'bg-yellow-500/20 text-yellow-400 border border-yellow-500/30' : 
                      'bg-blue-500/20 text-blue-400 border border-blue-500/30'
                    )}>{selectedListData.priority}</span>
                  )}
                </div>
                {selectedListData.description && <p className="text-foreground-muted mt-1 text-sm sm:text-base">{selectedListData.description}</p>}
                <div className="flex gap-4 mt-2 text-sm text-foreground-muted flex-wrap">
                  {selectedListData.category && <span className="flex items-center gap-1">{CATEGORIES.find(c => c.value === selectedListData.category)?.emoji} {selectedListData.category}</span>}
                  {selectedListData.deadline && <span className="flex items-center gap-1"><Calendar className="h-3.5 w-3.5" /> Due: {new Date(selectedListData.deadline).toLocaleDateString()}</span>}
                </div>
              </div>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={() => setShowAddItem(true)} className="gap-1">
                  <Plus className="h-4 w-4" /> Add Task
                </Button>
                <Button variant="outline" size="sm" onClick={handleEditListClick} className="gap-1">
                  <Pencil className="h-4 w-4" /><span className="hidden sm:inline">Edit</span>
                </Button>
                <Button variant="outline" size="sm" className="text-destructive hover:bg-destructive/10" onClick={() => handleDeleteListClick(selectedListId)}>
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </div>

          {/* Progress Bar */}
          <div className="mb-6 p-4 rounded-xl bg-gradient-to-br from-card to-card/50 border border-border relative overflow-hidden">
            <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,_var(--tw-gradient-stops))] from-primary/5 via-transparent to-transparent" />
            <div className="relative">
              <div className="flex justify-between text-sm mb-2">
                <span className="text-foreground-muted">Quest Progress</span>
                <span className="font-medium font-heading">{completed}/{items.length} Tasks</span>
              </div>
              <div className="h-3 rounded-full bg-background-secondary overflow-hidden">
                <motion.div 
                  initial={{ width: 0 }} 
                  animate={{ width: `${progress}%` }} 
                  transition={{ duration: 0.5, ease: "easeOut" }}
                  className={cn("h-full rounded-full", progress === 100 ? 'bg-gradient-to-r from-success to-emerald-400' : 'bg-gradient-to-r from-primary to-violet-500')} 
                />
              </div>
              {progress === 100 && <p className="text-xs text-success mt-2 font-medium">🎉 Quest Complete!</p>}
            </div>
          </div>

          {items.length === 0 ? (
            <div className="text-center py-12 text-foreground-muted">
              <Scroll className="h-12 w-12 mx-auto mb-4 opacity-50" />
              <p>No tasks yet. Add one above!</p>
            </div>
          ) : (
            <div className="space-y-2">
              <p className="text-xs text-foreground-muted mb-3 flex items-center gap-2">
                <span className="inline-block w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
                Drag tasks to reorder • Hover to edit or delete
              </p>
              <div className="space-y-2">
                {items.map((item: Item) => (
                  <TaskItem 
                    key={item.id} 
                    id={item.id} 
                    name={item.name} 
                    description={item.description} 
                    completed={Boolean(item.completed)} 
                    onToggle={handleToggleItem}
                    onEdit={handleEditItemClick}
                    onDelete={handleDeleteItemClick}
                    draggable={true}
                    onDragStart={handleDragStart}
                    onDragEnd={handleDragEnd}
                    onDragOver={handleDragOver}
                    onDragLeave={handleDragLeave}
                    onDrop={handleDrop}
                    isDragOver={dragOverItemId === item.id}
                    isDragging={draggedItemId === item.id}
                  />
                ))}
              </div>
            </div>
          )}

          <button onClick={() => setShowAddItem(true)} className="w-full mt-4 p-4 rounded-xl border-2 border-dashed border-border hover:border-primary/50 hover:bg-primary/5 flex items-center justify-center gap-2 text-foreground-muted text-sm transition-all group">
            <Plus className="h-5 w-5 group-hover:scale-110 transition-transform" /> Add New Task
          </button>
        </motion.div>

        {/* Add Item Dialog */}
        <Dialog open={showAddItem} onOpenChange={setShowAddItem}>
          <DialogContent>
            <DialogHeader><DialogTitle className="flex items-center gap-2"><Plus className="h-5 w-5 text-primary" /> Add Task</DialogTitle></DialogHeader>
            <div className="space-y-4 py-4">
              <div>
                <label className="text-sm font-medium block mb-1">Task Name *</label>
                <Input placeholder="What needs to be done?" value={newItemName} onChange={e => setNewItemName(e.target.value)} autoFocus />
              </div>
              <div>
                <label className="text-sm font-medium block mb-1">Description (optional)</label>
                <Textarea placeholder="Add more details..." value={newItemDesc} onChange={e => setNewItemDesc(e.target.value)} rows={3} />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => { setShowAddItem(false); setNewItemName(""); setNewItemDesc(""); }}>Cancel</Button>
              <Button onClick={handleAddItem} disabled={createItem.isPending} className="gap-2">
                {createItem.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} Add Task
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Edit List Dialog */}
        <Dialog open={showEditList} onOpenChange={setShowEditList}>
          <DialogContent className="max-w-md">
            <DialogHeader><DialogTitle className="flex items-center gap-2"><Pencil className="h-5 w-5 text-primary" /> Edit Quest</DialogTitle></DialogHeader>
            <div className="space-y-4 py-4">
              <div>
                <label className="text-sm font-medium block mb-1">Name *</label>
                <Input placeholder="Quest name..." value={editListName} onChange={e => setEditListName(e.target.value)} />
              </div>
              <div>
                <label className="text-sm font-medium block mb-1">Description (optional)</label>
                <Textarea placeholder="What's this quest about?" value={editListDesc} onChange={e => setEditListDesc(e.target.value)} rows={2} />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-sm font-medium block mb-1">Category</label>
                  <Select value={editListCategory} onValueChange={setEditListCategory}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>{CATEGORIES.filter(c => c.value !== 'all').map(c => <SelectItem key={c.value} value={c.value}>{c.emoji} {c.label}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div>
                  <label className="text-sm font-medium block mb-1">Priority</label>
                  <Select value={editListPriority} onValueChange={setEditListPriority}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>{PRIORITIES.filter(p => p.value !== 'all').map(p => <SelectItem key={p.value} value={p.value}>{p.emoji} {p.label}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
              </div>
              <div>
                <label className="text-sm font-medium block mb-1">Deadline (optional)</label>
                <Input type="date" value={editListDeadline} onChange={e => setEditListDeadline(e.target.value)} />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setShowEditList(false)}>Cancel</Button>
              <Button onClick={handleSaveList} disabled={updateList.isPending} className="gap-2">
                {updateList.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} Save Changes
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Edit Item Dialog */}
        <Dialog open={showEditItem} onOpenChange={setShowEditItem}>
          <DialogContent>
            <DialogHeader><DialogTitle className="flex items-center gap-2"><Pencil className="h-5 w-5 text-primary" /> Edit Task</DialogTitle></DialogHeader>
            <div className="space-y-4 py-4">
              <div>
                <label className="text-sm font-medium block mb-1">Task Name *</label>
                <Input placeholder="What needs to be done?" value={editItemName} onChange={e => setEditItemName(e.target.value)} autoFocus />
              </div>
              <div>
                <label className="text-sm font-medium block mb-1">Description (optional)</label>
                <Textarea placeholder="Add more details..." value={editItemDesc} onChange={e => setEditItemDesc(e.target.value)} rows={3} />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => { setShowEditItem(false); setEditingItem(null); }}>Cancel</Button>
              <Button onClick={handleSaveItem} disabled={updateItem.isPending} className="gap-2">
                {updateItem.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} Save
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Delete Item Confirmation */}
        <Dialog open={showDeleteItemConfirm} onOpenChange={setShowDeleteItemConfirm}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-full bg-destructive/20 flex items-center justify-center">
                  <Trash2 className="h-5 w-5 text-destructive" />
                </div>
                Delete Task
              </DialogTitle>
              <DialogDescription className="pt-2">
                Are you sure you want to delete this task? This action cannot be undone.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter className="gap-2 sm:gap-0">
              <Button variant="outline" onClick={() => setShowDeleteItemConfirm(false)}>Cancel</Button>
              <Button variant="destructive" onClick={handleDeleteItemConfirm} disabled={deleteItem.isPending}>
                {deleteItem.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Delete Task'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Delete List Confirmation */}
        <Dialog open={showDeleteListConfirm} onOpenChange={setShowDeleteListConfirm}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-full bg-destructive/20 flex items-center justify-center">
                  <Trash2 className="h-5 w-5 text-destructive" />
                </div>
                Delete Quest
              </DialogTitle>
              <DialogDescription className="pt-2">
                Are you sure you want to delete <span className="font-semibold text-foreground">"{selectedListData?.name}"</span>? 
                All tasks within this quest will also be deleted.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter className="gap-2 sm:gap-0">
              <Button variant="outline" onClick={() => setShowDeleteListConfirm(false)}>Cancel</Button>
              <Button variant="destructive" onClick={handleDeleteListConfirm} disabled={deleteList.isPending}>
                {deleteList.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Delete Quest'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </DashboardLayout>
    );
  }

  // LIST OVERVIEW
  return (
    <DashboardLayout>
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="px-4 sm:px-0">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 mb-6">
          <div>
            <h1 className="text-2xl sm:text-3xl font-heading font-bold flex items-center gap-2">
              <Scroll className="h-7 w-7 text-primary" />
              Quest Log
            </h1>
            <p className="text-foreground-muted text-sm sm:text-base">Manage your quests and track progress</p>
          </div>
          <Button variant="glow" onClick={() => setShowCreateList(true)} className="gap-2">
            <Plus className="h-4 w-4" /> Create Quest
          </Button>
        </div>

        {/* Tabs */}
        <div className="flex gap-2 mb-6 p-1 bg-background-secondary rounded-lg w-fit">
          <button
            onClick={() => setActiveTab("all")}
            className={cn(
              "flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-all",
              activeTab === "all"
                ? "bg-card text-foreground shadow-sm"
                : "text-foreground-muted hover:text-foreground hover:bg-card/50"
            )}
          >
            <Scroll className="h-4 w-4" />
            All
          </button>
          <button
            onClick={() => setActiveTab("current")}
            className={cn(
              "flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-all",
              activeTab === "current"
                ? "bg-card text-foreground shadow-sm"
                : "text-foreground-muted hover:text-foreground hover:bg-card/50"
            )}
          >
            <ListTodo className="h-4 w-4" />
            Current
          </button>
          <button
            onClick={() => setActiveTab("expired")}
            className={cn(
              "flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-all",
              activeTab === "expired"
                ? "bg-card text-foreground shadow-sm"
                : "text-foreground-muted hover:text-foreground hover:bg-card/50"
            )}
          >
            <Clock className="h-4 w-4" />
            Expired
          </button>
          <button
            onClick={() => setActiveTab("completed")}
            className={cn(
              "flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-all",
              activeTab === "completed"
                ? "bg-card text-foreground shadow-sm"
                : "text-foreground-muted hover:text-foreground hover:bg-card/50"
            )}
          >
            <CheckCircle2 className="h-4 w-4" />
            Completed
          </button>
        </div>

        {/* Search & Filters */}
        <div className="flex flex-col sm:flex-row gap-4 mb-6">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-foreground-muted" />
            <Input placeholder="Search quests..." value={searchQuery} onChange={e => setSearchQuery(e.target.value)} className="pl-10" />
          </div>
          <div className="flex gap-2">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="icon" className="relative">
                  <Filter className="h-4 w-4" />
                  {activeFilters > 0 && <span className="absolute -top-1 -right-1 h-4 w-4 rounded-full bg-primary text-[10px] flex items-center justify-center font-bold">{activeFilters}</span>}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuLabel>Filter By</DropdownMenuLabel>
                <DropdownMenuSeparator />
                <div className="p-2">
                  <label className="text-xs text-foreground-muted block mb-1">Category</label>
                  <Select value={categoryFilter} onValueChange={setCategoryFilter}>
                    <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
                    <SelectContent>{CATEGORIES.map(c => <SelectItem key={c.value} value={c.value}>{c.emoji} {c.label}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div className="p-2">
                  <label className="text-xs text-foreground-muted block mb-1">Priority</label>
                  <Select value={priorityFilter} onValueChange={setPriorityFilter}>
                    <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
                    <SelectContent>{PRIORITIES.map(p => <SelectItem key={p.value} value={p.value}>{p.emoji} {p.label}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div className="p-2">
                  <label className="text-xs text-foreground-muted block mb-1">Status</label>
                  <Select value={statusFilter} onValueChange={setStatusFilter}>
                    <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All</SelectItem>
                      <SelectItem value="active">Active</SelectItem>
                      <SelectItem value="completed">Completed</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => { setCategoryFilter('all'); setPriorityFilter('all'); setStatusFilter('all'); }}>
                  <X className="h-4 w-4 mr-2" /> Clear Filters
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>

            <DropdownMenu>
              <DropdownMenuTrigger asChild><Button variant="outline" size="icon"><SortAsc className="h-4 w-4" /></Button></DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuLabel>Sort By</DropdownMenuLabel>
                <DropdownMenuSeparator />
                {SORT_OPTIONS.map(o => (
                  <DropdownMenuItem key={o.value} onClick={() => setSortBy(o.value)}>
                    {sortBy === o.value && <Check className="h-4 w-4 mr-2" />}{o.label}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        {listsLoading ? (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {[...Array(6)].map((_, i) => <div key={i} className="h-48 rounded-xl bg-card/50 animate-pulse" />)}
          </div>
        ) : filteredAndSortedLists.length === 0 ? (
          <div className="text-center py-12">
            {(lists?.length || 0) === 0 ? (
              <>
                <AlertCircle className="h-12 w-12 mx-auto text-foreground-muted mb-4" />
                <h3 className="font-heading font-semibold mb-2">No quests yet</h3>
                <p className="text-foreground-muted mb-4 text-sm">Create your first quest to start your adventure!</p>
                <Button onClick={() => setShowCreateList(true)} className="gap-2"><Plus className="h-4 w-4" /> Create Quest</Button>
              </>
            ) : <p className="text-foreground-muted">No quests match your filters</p>}
          </div>
        ) : (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredAndSortedLists.map((list: ListWithCounts, i: number) => (
              <motion.div key={list.id} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }}>
                <TaskListCard 
                  name={list.name} 
                  description={list.description} 
                  itemsCompleted={list.itemsCompleted || 0} 
                  itemsTotal={list.itemsTotal || 0} 
                  category={list.category} 
                  priority={list.priority}
                  deadline={list.deadline}
                  onClick={() => setSelectedListId(list.id)} 
                />
              </motion.div>
            ))}
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="rounded-xl border-2 border-dashed border-border p-6 flex flex-col items-center justify-center cursor-pointer hover:border-primary/50 hover:bg-primary/5 min-h-[200px] transition-all group" onClick={() => setShowCreateList(true)}>
              <Plus className="h-8 w-8 text-foreground-muted mb-2 group-hover:scale-110 transition-transform" />
              <p className="text-foreground-muted text-sm">Create New Quest</p>
            </motion.div>
          </div>
        )}
      </motion.div>

      {/* Create List Dialog */}
      <Dialog open={showCreateList} onOpenChange={setShowCreateList}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle className="flex items-center gap-2"><Plus className="h-5 w-5 text-primary" /> Create Quest</DialogTitle></DialogHeader>
          <div className="space-y-4 py-4">
            <div>
              <label className="text-sm font-medium block mb-1">Name *</label>
              <Input placeholder="Quest name..." value={newListName} onChange={e => setNewListName(e.target.value)} />
            </div>
            <div>
              <label className="text-sm font-medium block mb-1">Description (optional)</label>
              <Textarea placeholder="What's this quest about?" value={newListDesc} onChange={e => setNewListDesc(e.target.value)} rows={2} />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-sm font-medium block mb-1">Category</label>
                <Select value={newListCategory} onValueChange={setNewListCategory}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{CATEGORIES.filter(c => c.value !== 'all').map(c => <SelectItem key={c.value} value={c.value}>{c.emoji} {c.label}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-sm font-medium block mb-1">Priority</label>
                <Select value={newListPriority} onValueChange={setNewListPriority}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{PRIORITIES.filter(p => p.value !== 'all').map(p => <SelectItem key={p.value} value={p.value}>{p.emoji} {p.label}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>
            <div>
              <label className="text-sm font-medium block mb-1">Deadline (optional)</label>
              <Input type="date" value={newListDeadline} onChange={e => setNewListDeadline(e.target.value)} min={new Date().toISOString().split('T')[0]} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setShowCreateList(false); setNewListName(""); setNewListDesc(""); setNewListCategory("none"); setNewListPriority("none"); setNewListDeadline(""); }}>Cancel</Button>
            <Button onClick={handleCreateList} disabled={createList.isPending} className="gap-2">
              {createList.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  );
};

export default Tasks;
