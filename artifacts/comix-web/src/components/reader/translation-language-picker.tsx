import { useState } from "react";
import { Check, ChevronsUpDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { TranslationLanguageOption } from "@/lib/translation-languages";

interface TranslationLanguagePickerProps {
  value: string;
  onChange: (language: string) => void;
  options: readonly TranslationLanguageOption[];
  label: string;
  disabled?: boolean;
}

export function TranslationLanguagePicker({
  value,
  onChange,
  options,
  label,
  disabled = false,
}: TranslationLanguagePickerProps) {
  const [open, setOpen] = useState(false);
  const selectedLabel = options.find(option => option.value === value)?.label ?? value;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-label={label}
          aria-expanded={open}
          disabled={disabled}
          className="w-full justify-between font-normal"
          onClick={event => event.stopPropagation()}
        >
          <span className="truncate">{selectedLabel}</span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-[var(--radix-popover-trigger-width)] p-0"
        onClick={event => event.stopPropagation()}
      >
        <Command>
          <CommandInput placeholder={`Search ${label.toLowerCase()}…`} aria-label={`Search ${label.toLowerCase()}`} />
          <CommandList>
            <CommandEmpty>No matching language.</CommandEmpty>
            <CommandGroup>
              {options.map(option => (
                <CommandItem
                  key={option.value}
                  value={option.value}
                  keywords={option.keywords ? [...option.keywords] : undefined}
                  onSelect={selected => {
                    onChange(selected);
                    setOpen(false);
                  }}
                >
                  <Check className={`h-4 w-4 ${value === option.value ? "opacity-100" : "opacity-0"}`} />
                  <span>{option.label}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
