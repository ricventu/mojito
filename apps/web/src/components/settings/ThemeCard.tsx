import { useState } from "react";
import { Moon, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { applyTheme, readTheme, writeTheme, type Theme } from "@/lib/theme";

/** Dark / light: a preference of this browser, kept in localStorage and applied to `<html>`. */
export function ThemeCard() {
  const [theme, setTheme] = useState<Theme>(() => readTheme());

  function choose(next: Theme) {
    setTheme(next);
    writeTheme(next);
    applyTheme(next);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Theme</CardTitle>
        <CardDescription>Applies to this browser only.</CardDescription>
      </CardHeader>
      <CardContent className="flex gap-2">
        <Button variant={theme === "dark" ? "default" : "outline"} aria-pressed={theme === "dark"} onClick={() => choose("dark")}>
          <Moon size={16} /> Dark
        </Button>
        <Button variant={theme === "light" ? "default" : "outline"} aria-pressed={theme === "light"} onClick={() => choose("light")}>
          <Sun size={16} /> Light
        </Button>
      </CardContent>
    </Card>
  );
}
