import { articleStatusLabel, incidentStatusLabel, type ArticleStatus, type IncidentStatus } from "@reto/shared";
import { Badge } from "@/components/ui/badge";

const articleStyles: Record<ArticleStatus, string> = {
  draft: "text-muted-foreground",
  published: "border-success/30 bg-success-soft text-success-foreground",
  archived: "border-border bg-muted text-muted-foreground",
};

export function ArticleStatusBadge({ status }: { status: ArticleStatus }) {
  return (
    <Badge variant="outline" className={articleStyles[status]}>
      {articleStatusLabel[status]}
    </Badge>
  );
}

const incidentStyles: Record<IncidentStatus, string> = {
  investigating: "border-destructive/40 bg-destructive/10 text-destructive",
  identified: "border-gold/40 bg-gold-soft text-gold-foreground",
  monitoring: "border-brand/30 bg-brand/10 text-primary dark:text-brand",
  resolved: "border-success/30 bg-success-soft text-success-foreground",
};

export function IncidentStatusBadge({ status }: { status: IncidentStatus }) {
  return (
    <Badge variant="outline" className={incidentStyles[status]}>
      {incidentStatusLabel[status]}
    </Badge>
  );
}
