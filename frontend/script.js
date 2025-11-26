fetch("http://localhost:3000/api/stalkers?username=harshit_1308")
  .then(res => res.json())
  .then(cards => {

    const div = document.querySelector(".cards");

    cards.forEach(card => {
      div.innerHTML += `
        <div class="card">
          <div class="profile-img"
            style="background-image:url('${card.image}')"></div>
          <h4>${card.username}</h4>
        </div>
      `;
    });
  });

