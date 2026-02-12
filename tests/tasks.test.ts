import request from "supertest";
import app from "../src/app";

describe("Tasks", () => {
  it("POST /tasks creates a task and GET /tasks lists it", async () => {
    const cat = await request(app).post("/categories").send({ name: "Cat" });
    const categoryId = cat.body.id;

    const created = await request(app).post("/tasks").send({ title: "My Task", categoryId });
    expect([200, 201]).toContain(created.status);
    expect(created.body).toEqual(
      expect.objectContaining({
        id: expect.any(Number),
        title: "My Task",
        category_id: categoryId,
      })
    );

    const list = await request(app).get(
      `/tasks?categoryId=${categoryId}&showCompleted=false&showArchived=false`
    );
    expect(list.status).toBe(200);
    expect(list.body.some((t: any) => t.id === created.body.id)).toBe(true);
  });

  it("PATCH /tasks/:id completes a task", async () => {
    const cat = await request(app).post("/categories").send({ name: "Cat" });
    const categoryId = cat.body.id;

    const created = await request(app).post("/tasks").send({ title: "Complete Me", categoryId });
    const id = created.body.id;

    const updated = await request(app).patch(`/tasks/${id}`).send({ isCompleted: true });
    expect(updated.status).toBe(200);
    expect(updated.body).toEqual(expect.objectContaining({ id, is_completed: true }));
  });

  it("PATCH /tasks/:id moves a task to another category", async () => {
    const catA = await request(app).post("/categories").send({ name: "A" });
    const catB = await request(app).post("/categories").send({ name: "B" });

    const created = await request(app).post("/tasks").send({ title: "Move Me", categoryId: catA.body.id });
    const id = created.body.id;

    const moved = await request(app).patch(`/tasks/${id}`).send({ categoryId: catB.body.id });
    expect(moved.status).toBe(200);
    expect(moved.body).toEqual(expect.objectContaining({ id, category_id: catB.body.id }));
  });

  it("DELETE /tasks/:id deletes a task", async () => {
    const cat = await request(app).post("/categories").send({ name: "Cat" });
    const created = await request(app).post("/tasks").send({ title: "Delete Me", categoryId: cat.body.id });
    const id = created.body.id;

    const del = await request(app).delete(`/tasks/${id}`);
    expect([200, 204]).toContain(del.status);
  });
});
