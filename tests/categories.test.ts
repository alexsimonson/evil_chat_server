import request from "supertest";
import app from "../src/app";

describe("Categories", () => {
  it("GET /categories returns an array", async () => {
    const res = await request(app).get("/categories");
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it("POST /categories creates a category", async () => {
    const res = await request(app).post("/categories").send({ name: "Test Category" });
    expect([200, 201]).toContain(res.status);
    expect(res.body).toEqual(expect.objectContaining({ id: expect.any(Number), name: "Test Category" }));
  });

  it("PATCH /categories/:id renames a category", async () => {
    const created = await request(app).post("/categories").send({ name: "Old" });
    const id = created.body.id;

    const res = await request(app).patch(`/categories/${id}`).send({ name: "New" });
    expect(res.status).toBe(200);
    expect(res.body).toEqual(expect.objectContaining({ id, name: "New" }));
  });

  it("DELETE /categories/:id deletes a category", async () => {
    const created = await request(app).post("/categories").send({ name: "Delete Me" });
    const id = created.body.id;

    const res = await request(app).delete(`/categories/${id}`);
    expect([200, 204]).toContain(res.status);
  });
});
