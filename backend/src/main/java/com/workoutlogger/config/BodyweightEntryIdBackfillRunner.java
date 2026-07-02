package com.workoutlogger.config;

import com.mongodb.client.MongoCollection;
import org.bson.Document;
import org.bson.types.ObjectId;
import org.springframework.boot.autoconfigure.condition.ConditionalOnWebApplication;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.event.EventListener;
import org.springframework.data.mongodb.core.MongoTemplate;
import org.springframework.stereotype.Component;

import java.util.ArrayList;
import java.util.List;

/**
 * One-time remediation of legacy bodyweight entries, run at every normal server start until clean
 * (self-terminating: once no entry lacks {@code entryId}, the scan matches nothing).
 *
 * <p>Why it exists (audit M3): entry ids used to live on a record component named {@code id}, which
 * Spring Data stores as the embedded {@code _id} — and the {@code MeController.current()} read path
 * minted missing ids with a full-document {@code save()} on every GET, a write-on-read that raced (and
 * lost) concurrent updates. The rename to {@code entryId} orphans both legacy shapes: entries whose id
 * sits under {@code _id}, and entries with no id at all. This runner rebuilds those arrays ONCE at boot:
 * an existing {@code _id} value is COPIED into {@code entryId} (the id the client already holds must
 * survive), a missing one is minted fresh.
 *
 * <p>It reads the RAW documents (the mapped entity would deserialize legacy {@code _id} ids as null and
 * drop them) and rewrites {@code bodyweightLog} per affected doc — never settings/profile. Unconditional
 * rather than {@code schemaVersion}-gated: a version bump can't be atomic with the backfill, but a
 * self-terminating scan can't lie.
 *
 * <p><b>The rewrite is a compare-and-swap, not a blind {@code $set}</b>: the embedded Tomcat connector
 * starts serving inside {@code refresh()}, BEFORE {@code ApplicationReadyEvent} fires, so live
 * {@code MeRepository} writes can land between this runner's read and its write. The update therefore
 * matches on the exact array snapshot it read ({@code {_id, bodyweightLog: <T0 array>}}); if a concurrent
 * {@code $push}/{@code $pull}/positional-{@code $set} won the race, the CAS misses, and the doc is
 * retried on the next pass (bounded) or the next boot — a stale snapshot can never overwrite a
 * committed write (review-council finding: the blind form reintroduced the exact M3 lost-update class).
 */
@Component
@ConditionalOnWebApplication(type = ConditionalOnWebApplication.Type.SERVLET)
public class BodyweightEntryIdBackfillRunner {

    private static final org.slf4j.Logger log = org.slf4j.LoggerFactory.getLogger(BodyweightEntryIdBackfillRunner.class);

    private final MongoTemplate mongo;

    public BodyweightEntryIdBackfillRunner(MongoTemplate mongo) {
        this.mongo = mongo;
    }

    @EventListener(ApplicationReadyEvent.class)
    public void run() {
        int fixed = backfillAll();
        if (fixed > 0) log.info("Backfilled bodyweight entry ids on {} user doc(s)", fixed);
    }

    /** @return the number of user docs remediated (0 on an already-clean DB — the terminal state). */
    public int backfillAll() {
        // A CAS miss (concurrent write between read and rewrite) leaves the doc for the next pass. Loop
        // while the scan still SEES dirty docs (bounded) — terminating on fixed==0 would conflate "clean"
        // with "every doc missed its CAS", which is exactly the boot-window shape the retry exists for;
        // anything still dirty after the bound is caught on the next boot.
        int fixed = 0;
        for (int pass = 0; pass < 3; pass++) {
            int[] seenFixed = backfillPass();
            fixed += seenFixed[1];
            if (seenFixed[0] == 0) break;                  // clean scan — the terminal state
        }
        return fixed;
    }

    /** @return {seen, fixed} for one scan: dirty docs found, and how many CAS rewrites landed. */
    private int[] backfillPass() {
        MongoCollection<Document> users = mongo.getDb().getCollection("users");
        Document filter = new Document("bodyweightLog",
                new Document("$elemMatch", new Document("entryId", new Document("$exists", false))));
        int seen = 0, fixed = 0;
        for (Document doc : users.find(filter)) {
            seen++;
            List<Document> snapshot = doc.getList("bodyweightLog", Document.class);
            List<Document> rebuilt = new ArrayList<>();
            for (Document e : snapshot) {
                Document r = new Document(e);              // never mutate the snapshot — it IS the CAS key
                if (r.get("entryId") == null) {
                    Object legacy = r.remove("_id");       // pre-rename ids were stored under _id
                    r.put("entryId", legacy != null ? legacy.toString() : new ObjectId().toHexString());
                }
                rebuilt.add(r);
            }
            // Compare-and-swap: only rewrite if the array is exactly what we read. A concurrent
            // $push/$pull/positional-$set makes this miss (matchedCount 0) instead of being clobbered.
            long matched = users.updateOne(
                    new Document("_id", doc.get("_id")).append("bodyweightLog", snapshot),
                    new Document("$set", new Document("bodyweightLog", rebuilt))).getMatchedCount();
            if (matched > 0) fixed++;
        }
        return new int[]{seen, fixed};
    }
}
