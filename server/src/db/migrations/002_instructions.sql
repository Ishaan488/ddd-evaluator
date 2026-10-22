-- Extra instructions a person types when submitting work (the "prompt box"). They are given to the
-- raters and the consolidator, so they are kept with the run to make the result reproducible.

alter table runs add column instructions text
