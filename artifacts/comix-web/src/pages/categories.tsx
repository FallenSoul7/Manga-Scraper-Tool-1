import { useState, useMemo } from "react";
import { useStore, storeActions } from "@/lib/storage";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Link } from "wouter";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel,
  AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Plus, Pencil, Trash2, GripVertical, ArrowLeft } from "lucide-react";

export default function CategoriesPage() {
  const categories = useStore(s => s.categories);
  const library = useStore(s => s.library);

  const sorted = useMemo(
    () => [...categories].sort((a, b) => a.order - b.order),
    [categories],
  );

  const [newName, setNewName] = useState("");
  const [isNewOpen, setIsNewOpen] = useState(false);

  const [renameOpen, setRenameOpen] = useState<{ id: string; name: string } | null>(null);
  const [renameValue, setRenameValue] = useState("");

  const countFor = (catId: string) =>
    Object.values(library).filter(m => m.categoryIds.includes(catId)).length;

  const handleAdd = () => {
    if (newName.trim()) {
      storeActions.addCategory(newName.trim());
      setNewName("");
      setIsNewOpen(false);
    }
  };

  const handleRename = () => {
    if (renameOpen && renameValue.trim()) {
      storeActions.renameCategory?.(renameOpen.id, renameValue.trim());
      setRenameOpen(null);
      setRenameValue("");
    }
  };

  const handleDelete = (id: string) => {
    storeActions.removeCategory(id);
  };

  return (
    <main className="container mx-auto px-4 pt-4 pb-8 max-w-xl animate-in fade-in duration-300">
      <Link href="/system" className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors w-fit mb-4">
        <ArrowLeft className="h-4 w-4" />
        System
      </Link>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-foreground">Categories</h1>
        <Button size="sm" onClick={() => setIsNewOpen(true)} className="gap-1.5">
          <Plus className="h-4 w-4" />
          New
        </Button>
      </div>

      {sorted.length === 0 ? (
        <div className="py-16 text-center text-muted-foreground">
          <p className="mb-4">No categories yet.</p>
          <Button onClick={() => setIsNewOpen(true)}>Create first category</Button>
        </div>
      ) : (
        <div className="divide-y divide-border/40 rounded-xl border border-border overflow-hidden">
          {sorted.map((cat) => {
            const count = countFor(cat.id);
            const isDefault = cat.id === "default";
            return (
              <div key={cat.id} className="flex items-center gap-3 px-4 py-3 bg-card">
                <GripVertical className="h-4 w-4 text-muted-foreground/40 shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-sm text-foreground">{cat.name}</p>
                  <p className="text-xs text-muted-foreground">{count} title{count !== 1 ? "s" : ""}</p>
                </div>
                {!isDefault && (
                  <div className="flex items-center gap-1 shrink-0">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-muted-foreground hover:text-foreground"
                      onClick={() => {
                        setRenameOpen({ id: cat.id, name: cat.name });
                        setRenameValue(cat.name);
                      }}
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Delete "{cat.name}"?</AlertDialogTitle>
                          <AlertDialogDescription>
                            {count > 0
                              ? `${count} title${count !== 1 ? "s" : ""} will be moved to Default.`
                              : "This category is empty and will be removed."}
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancel</AlertDialogCancel>
                          <AlertDialogAction
                            onClick={() => handleDelete(cat.id)}
                            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                          >
                            Delete
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </div>
                )}
                {isDefault && (
                  <span className="text-[10px] text-muted-foreground px-2 py-0.5 rounded bg-muted shrink-0">
                    Default
                  </span>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* New category dialog */}
      <Dialog open={isNewOpen} onOpenChange={setIsNewOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>New Category</DialogTitle></DialogHeader>
          <div className="py-4">
            <Input
              autoFocus
              placeholder="Category name"
              value={newName}
              onChange={e => setNewName(e.target.value)}
              onKeyDown={e => e.key === "Enter" && handleAdd()}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsNewOpen(false)}>Cancel</Button>
            <Button onClick={handleAdd} disabled={!newName.trim()}>Add</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Rename dialog */}
      <Dialog open={renameOpen !== null} onOpenChange={open => !open && setRenameOpen(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Rename Category</DialogTitle></DialogHeader>
          <div className="py-4">
            <Input
              autoFocus
              value={renameValue}
              onChange={e => setRenameValue(e.target.value)}
              onKeyDown={e => e.key === "Enter" && handleRename()}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRenameOpen(null)}>Cancel</Button>
            <Button onClick={handleRename} disabled={!renameValue.trim()}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </main>
  );
}
